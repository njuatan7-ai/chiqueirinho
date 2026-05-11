require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const session = require("express-session");
const crypto = require("crypto");

const { avisarRepasse, getAcessoDiscord } = require("./bot");

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

let passes = [
  { id: "default_chiqueirinho", nome: "Chiqueirinho Pass", dono: "Sebastião", discordId: null, createdAt: new Date().toISOString() },
  { id: "default_kzix", nome: "Kzix Pass", dono: "Kzix", discordId: null, createdAt: new Date().toISOString() },
  { id: "default_suicide", nome: "Suicide Pass", dono: "Suicide", discordId: null, createdAt: new Date().toISOString() },
  { id: "default_alemon", nome: "Alemon Pass", dono: "Alemon", discordId: null, createdAt: new Date().toISOString() }
];

const tokenSessions = new Map();

function criarToken(user) {
  const token = crypto.randomBytes(32).toString("hex");
  tokenSessions.set(token, { user, createdAt: Date.now() });
  return token;
}

function getUserFromRequest(req) {
  const auth = req.headers.authorization || "";

  if (auth.startsWith("Bearer ")) {
    const token = auth.replace("Bearer ", "").trim();
    const sessionData = tokenSessions.get(token);

    if (sessionData?.user) return sessionData.user;
  }

  return req.session.user || null;
}

function requireLogin(req, res, next) {
  const user = getUserFromRequest(req);

  if (!user) {
    return res.status(401).json({ error: "Não logado" });
  }

  req.user = user;
  next();
}

function requireCaller(req, res, next) {
  if (!req.user?.caller && !req.user?.staff) {
    return res.status(403).json({ error: "Apenas caller ou staff pode fazer isso." });
  }

  next();
}

function requireStaff(req, res, next) {
  if (!req.user?.staff) {
    return res.status(403).json({ error: "Apenas staff pode fazer isso." });
  }

  next();
}

function isStaffEnv(userId) {
  const ids = (process.env.STAFF_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  return ids.includes(userId);
}

function nomeUsuario(user) {
  return user.globalName || user.username;
}

async function montarUsuarioDiscord(discordUser) {
  const acesso = await getAcessoDiscord(discordUser.id);

  const staff = isStaffEnv(discordUser.id) || acesso.staff;
  const caller = staff || acesso.caller;

  return {
    id: discordUser.id,
    username: discordUser.username,
    globalName: discordUser.global_name,
    avatar: discordUser.avatar,
    caller,
    staff,
    roles: acesso.roles || []
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Chiqueirinho backend online",
    health: "/api/health"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend online" });
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
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenResponse.data.access_token;

    const userResponse = await axios.get(
      "https://discord.com/api/users/@me",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const discordUser = userResponse.data;
    const user = await montarUsuarioDiscord(discordUser);

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
    return res.json({ logged: false });
  }

  res.json({ logged: true, user });
});

/* PASSES / PS */
app.get("/api/passes", requireLogin, (req, res) => {
  res.json(passes);
});

app.post("/api/passes", requireLogin, requireStaff, (req, res) => {
  const { nome, dono, discordId } = req.body;

  if (!nome || !dono) {
    return res.status(400).json({ error: "Nome do PS e dono são obrigatórios." });
  }

  const novoPass = {
    id: Date.now().toString(),
    nome,
    dono,
    discordId: discordId || null,
    createdAt: new Date().toISOString()
  };

  passes.unshift(novoPass);

  res.json({ ok: true, pass: novoPass });
});

app.delete("/api/passes/:id", requireLogin, requireStaff, (req, res) => {
  const before = passes.length;
  passes = passes.filter(p => p.id !== req.params.id);

  res.json({ ok: true, removed: before !== passes.length });
});

/* RUNS */
app.post("/api/runs", requireLogin, requireCaller, async (req, res) => {
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
    const passInfo = passes.find(p => p.nome === rep.pass);

    const novoRepasse = {
      id: Date.now().toString() + Math.random().toString(16).slice(2),
      runId: run.id,

      devedorNome: rep.dono,
      devedorDiscordId: rep.donoDiscordId || passInfo?.discordId || null,

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

  res.json({ ok: true, run, repassesCriados: run.repasses.length });
});

app.get("/api/runs", requireLogin, (req, res) => {
  if (req.user.staff) return res.json(runs);

  const minhas = runs.filter(r => r.callerId === req.user.id);
  res.json(minhas);
});

/* REPASSES */
app.get("/api/repasses", requireLogin, (req, res) => {
  if (req.user.staff) return res.json(repasses);

  const userId = req.user.id;
  const nome = nomeUsuario(req.user).toLowerCase();

  const meus = repasses.filter(r =>
    r.devedorDiscordId === userId ||
    r.credorDiscordId === userId ||
    (r.devedorNome || "").toLowerCase() === nome ||
    (r.credorNome || "").toLowerCase() === nome
  );

  res.json(meus);
});

app.post("/api/repasses/:id/paguei", requireLogin, (req, res) => {
  const rep = repasses.find(r => r.id === req.params.id);

  if (!rep) return res.status(404).json({ error: "Repasse não encontrado" });

  const userId = req.user.id;

  if (!req.user.staff && rep.devedorDiscordId && rep.devedorDiscordId !== userId) {
    return res.status(403).json({ error: "Só quem deve pagar ou staff pode confirmar pagamento." });
  }

  rep.pagadorConfirmou = true;
  rep.status = rep.recebedorConfirmou ? "confirmado" : "aguardando_recebedor";

  res.json({ ok: true, repasse: rep });
});

app.post("/api/repasses/:id/recebi", requireLogin, (req, res) => {
  const rep = repasses.find(r => r.id === req.params.id);

  if (!rep) return res.status(404).json({ error: "Repasse não encontrado" });

  const userId = req.user.id;

  if (!req.user.staff && rep.credorDiscordId !== userId) {
    return res.status(403).json({ error: "Só quem recebe ou staff pode confirmar recebimento." });
  }

  rep.recebedorConfirmou = true;
  rep.status = rep.pagadorConfirmou ? "confirmado" : "aguardando_pagador";

  res.json({ ok: true, repasse: rep });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Backend online: http://localhost:${PORT}`);
});
