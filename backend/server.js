javascript
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const session = require("express-session");
const crypto = require("crypto");

const { avisarRepasse } = require("./bot");

const app = express();

app.use(express.json({ limit: "2mb" }));

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.set("trust proxy", 1);

app.use(session({
  secret: process.env.SESSION_SECRET || "chiqueirinho_dev_secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: "none"
  }
}));

const runs = [];
const repasses = [];

const tokenSessions = new Map();

function criarToken(user) {
  const token = crypto.randomBytes(32).toString("hex");

  tokenSessions.set(token, {
    user,
    createdAt: Date.now()
  });

  return token;
}

function getUserFromRequest(req) {
  const auth = req.headers.authorization || "";

  if (auth.startsWith("Bearer ")) {
    const token = auth.replace("Bearer ", "").trim();
    const sessionData = tokenSessions.get(token);

    if (sessionData?.user) {
      return sessionData.user;
    }
  }

  return req.session.user || null;
}

function requireLogin(req, res, next) {
  const user = getUserFromRequest(req);

  if (!user) {
    return res.status(401).json({
      error: "Não logado"
    });
  }

  req.user = user;
  next();
}

function isStaff(userId) {
  const ids = (process.env.STAFF_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  return ids.includes(userId);
}

function nomeUsuario(user) {
  return user.globalName || user.username;
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Chiqueirinho backend online",
    health: "/api/health"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend online"
  });
});

app.get("/auth/discord", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify"
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).send("Código OAuth não encontrado.");
    }

    const tokenResponse = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const accessToken = tokenResponse.data.access_token;

    const userResponse = await axios.get(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const discordUser = userResponse.data;

    const user = {
      id: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.global_name,
      avatar: discordUser.avatar,
      staff: isStaff(discordUser.id)
    };

    req.session.user = user;

    const appToken = criarToken(user);

    const redirectUrl = new URL(process.env.FRONTEND_URL);
    redirectUrl.searchParams.set("token", appToken);

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.log("Erro OAuth:", err.response?.data || err.message);
    res.status(500).send("Erro no login Discord.");
  }
});

app.get("/api/me", (req, res) => {
  const user = getUserFromRequest(req);

  if (!user) {
    return res.json({
      logged: false
    });
  }

  res.json({
    logged: true,
    user
  });
});

app.post("/api/runs", requireLogin, async (req, res) => {
  const body = req.body;

  const callerName = nomeUsuario(req.user);

  const run = {
    id: Date.now().toString(),
    callerId: req.user.id,
    callerName,
    createdAt: new Date().toISOString(),

    dgs: body.dgs || 0,
    baus: body.baus || 0,

    totalIndividual: body.total || 0,
    totalBruto: body.totalBruto || 0,
    totalRun: body.totalRun || 0,
    regearServer: body.regearServer || 0,

    mvp: body.mvp || null,
    players: body.players || [],
    passes: body.passes || [],
    repasses: body.repasses || []
  };

  runs.unshift(run);

  for (const rep of run.repasses) {
    const novoRepasse = {
      id: Date.now().toString() + Math.random().toString(16).slice(2),
      runId: run.id,

      devedorNome: rep.dono,
      devedorDiscordId: rep.donoDiscordId || null,

      credorNome: run.callerName,
      credorDiscordId: req.user.id,

      player: rep.player,
      pass: rep.pass,
      valor: rep.valor,

      pagadorConfirmou: false,
      recebedorConfirmou: false,
      status: "pendente",

      createdAt: new Date().toISOString()
    };

    repasses.unshift(novoRepasse);

    avisarRepasse(novoRepasse).catch(err => {
      console.log("Erro avisando repasse:", err.message);
    });
  }

  res.json({
    ok: true,
    run,
    repassesCriados: run.repasses.length
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Backend online: http://localhost:${PORT}`);
});
