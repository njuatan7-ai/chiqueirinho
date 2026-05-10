require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const session = require("express-session");

const { avisarRepasse } = require("./bot");

const app = express();

app.use(express.json());

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));

app.use(session({
  secret: process.env.SESSION_SECRET,

  resave: false,
  saveUninitialized: false,

  cookie: {
    secure: false,
    httpOnly: true
  }
}));

const runs = [];
const repasses = [];

function requireLogin(req, res, next) {

  if (!req.session.user) {
    return res.status(401).json({
      error: "Não logado"
    });
  }

  next();
}

function isStaff(userId) {

  const ids = (process.env.STAFF_IDS || "")
    .split(",")
    .map(id => id.trim());

  return ids.includes(userId);
}

app.get("/api/health", (req, res) => {

  res.json({
    ok: true,
    message: "Backend online"
  });

});

app.get("/auth/discord", (req, res) => {

  const params = new URLSearchParams({

    client_id: process.env.DISCORD_CLIENT_ID,

    redirect_uri:
      process.env.DISCORD_REDIRECT_URI,

    response_type: "code",

    scope: "identify"

  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );

});

app.get("/auth/discord/callback", async (req, res) => {

  try {

    const code = req.query.code;

    const tokenResponse = await axios.post(

      "https://discord.com/api/oauth2/token",

      new URLSearchParams({

        client_id:
          process.env.DISCORD_CLIENT_ID,

        client_secret:
          process.env.DISCORD_CLIENT_SECRET,

        grant_type: "authorization_code",

        code,

        redirect_uri:
          process.env.DISCORD_REDIRECT_URI

      }),

      {
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        }
      }

    );

    const accessToken =
      tokenResponse.data.access_token;

    const userResponse = await axios.get(

      "https://discord.com/api/users/@me",

      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }

    );

    const discordUser = userResponse.data;

    req.session.user = {

      id: discordUser.id,

      username:
        discordUser.username,

      globalName:
        discordUser.global_name,

      avatar:
        discordUser.avatar,

      staff:
        isStaff(discordUser.id)

    };

    res.redirect(process.env.FRONTEND_URL);

  } catch (err) {

    console.log(err.response?.data || err);

    res.status(500).send(
      "Erro no login Discord."
    );
  }

});

app.get("/api/me", (req, res) => {

  if (!req.session.user) {

    return res.json({
      logged: false
    });

  }

  res.json({
    logged: true,
    user: req.session.user
  });

});

app.post("/api/runs", requireLogin, async (req, res) => {

  const body = req.body;

  const run = {

    id: Date.now().toString(),

    callerId:
      req.session.user.id,

    callerName:
      req.session.user.globalName ||
      req.session.user.username,

    createdAt:
      new Date().toISOString(),

    dgs:
      body.dgs || 0,

    baus:
      body.baus || 0,

    total:
      body.total || 0,

    players:
      body.players || [],

    repasses:
      body.repasses || []

  };

  runs.unshift(run);

  for (const rep of run.repasses) {

    const novoRepasse = {

      id:
        Date.now().toString() +
        Math.random(),

      runId:
        run.id,

      devedorNome:
        rep.dono,

      credorNome:
        run.callerName,

      player:
        rep.player,

      pass:
        rep.pass,

      valor:
        rep.valor,

      status:
        "pendente",

      pagadorConfirmou:
        false,

      recebedorConfirmou:
        false

    };

    repasses.unshift(novoRepasse);

    await avisarRepasse(novoRepasse);

  }

  res.json({
    ok: true,
    run
  });

});

app.get("/api/repasses", requireLogin, (req, res) => {

  const nome =
    req.session.user.globalName ||
    req.session.user.username;

  const meus = repasses.filter(r =>

    r.devedorNome.toLowerCase()
      === nome.toLowerCase()

    ||

    r.credorNome.toLowerCase()
      === nome.toLowerCase()

    ||

    req.session.user.staff

  );

  res.json(meus);

});

app.post(
  "/api/repasses/:id/paguei",
  requireLogin,
  (req, res) => {

    const rep = repasses.find(
      r => r.id === req.params.id
    );

    if (!rep) {

      return res.status(404).json({
        error: "Repasse não encontrado"
      });

    }

    rep.pagadorConfirmou = true;

    if (
      rep.pagadorConfirmou &&
      rep.recebedorConfirmou
    ) {

      rep.status = "confirmado";

    }

    res.json({
      ok: true,
      rep
    });

  }
);

app.post(
  "/api/repasses/:id/recebi",
  requireLogin,
  (req, res) => {

    const rep = repasses.find(
      r => r.id === req.params.id
    );

    if (!rep) {

      return res.status(404).json({
        error: "Repasse não encontrado"
      });

    }

    rep.recebedorConfirmou = true;

    if (
      rep.pagadorConfirmou &&
      rep.recebedorConfirmou
    ) {

      rep.status = "confirmado";

    }

    res.json({
      ok: true,
      rep
    });

  }
);

app.listen(process.env.PORT, () => {

  console.log(
    `🚀 Backend online: http://localhost:${process.env.PORT}`
  );

});