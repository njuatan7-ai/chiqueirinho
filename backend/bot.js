require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require("discord.js");

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

bot.once("clientReady", () => {
  console.log(`🤖 Bot online: ${bot.user.tag}`);
});

function formatarValor(valor) {
  return Number(valor || 0).toLocaleString("pt-BR");
}

async function getAcessoDiscord(userId) {
  try {
    if (!process.env.GUILD_ID) {
      return { caller: false, staff: false, roles: [], erro: "GUILD_ID não configurado" };
    }

    const guild = await bot.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(userId);
    const roles = member.roles.cache.map(role => role.id);

    const isCaller = roles.includes(process.env.CALLER_ROLE_ID);
    const isStaff = roles.includes(process.env.STAFF_ROLE_ID);

    return {
      caller: isCaller || isStaff,
      staff: isStaff,
      roles
    };
  } catch (err) {
    console.log("⚠️ Erro ao buscar cargos do usuário:", err.message);
    return { caller: false, staff: false, roles: [], erro: err.message };
  }
}

function criarEmbedRepasse(repasse, tipo = "devedor") {
  const titulo = tipo === "credor"
    ? "📥 Repasse para receber"
    : "💸 Repasse pendente";

  const descricao = tipo === "credor"
    ? `Você tem **${formatarValor(repasse.valor)}** para receber de **${repasse.devedorNome}**.`
    : `Você deve pagar **${formatarValor(repasse.valor)}** para **${repasse.credorNome}**.`;

  return new EmbedBuilder()
    .setColor(0xff4da6)
    .setTitle(titulo)
    .setDescription(descricao)
    .addFields(
      { name: "👤 Player que usou PS", value: repasse.player || "Não informado", inline: true },
      { name: "🎟 PS usado", value: repasse.pass || "Não informado", inline: true },
      { name: "🏰 Caller / DG", value: repasse.credorNome || "Não informado", inline: true },
      { name: "📌 Status", value: "🔴 Pendente", inline: true }
    )
    .setFooter({ text: "Chiqueirinho Avaloniano • Abra o painel para confirmar" })
    .setTimestamp();
}

async function enviarDM(userId, embed, label) {
  if (!userId) {
    console.log(`⚠️ Sem Discord ID para ${label || "usuário"}.`);
    return false;
  }

  try {
    const user = await bot.users.fetch(userId);
    await user.send({ embeds: [embed] });
    console.log(`📩 DM enviada para ${label || userId}`);
    return true;
  } catch (err) {
    console.log(`⚠️ Não consegui enviar DM para ${label || userId}: ${err.message}`);
    return false;
  }
}

async function avisarRepasse(repasse) {
  await enviarDM(repasse.devedorDiscordId, criarEmbedRepasse(repasse, "devedor"), repasse.devedorNome);
  await enviarDM(repasse.credorDiscordId, criarEmbedRepasse(repasse, "credor"), repasse.credorNome);
}

if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN !== "COLOQUE_O_TOKEN_DO_BOT") {
  bot.login(process.env.DISCORD_BOT_TOKEN)
    .then(() => console.log("✅ Login do bot realizado."))
    .catch(err => {
      console.log("❌ Token inválido:");
      console.log(err);
    });
} else {
  console.log("⚠️ Bot sem token válido. Backend rodando sem Discord bot.");
}

module.exports = {
  bot,
  avisarRepasse,
  getAcessoDiscord
};
