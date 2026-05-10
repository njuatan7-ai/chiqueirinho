require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require("discord.js");

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

bot.once("ready", () => {
  console.log(`🤖 Bot online: ${bot.user.tag}`);
});

async function avisarRepasse(repasse) {

  try {

    if (
      !process.env.DISCORD_REPASSES_CHANNEL_ID ||
      process.env.DISCORD_REPASSES_CHANNEL_ID === "COLOQUE_ID_DO_CANAL"
    ) {
      console.log("⚠️ Canal de repasse não configurado.");
      return;
    }

    const canal = await bot.channels.fetch(
      process.env.DISCORD_REPASSES_CHANNEL_ID
    );

    if (!canal) {
      console.log("⚠️ Canal não encontrado.");
      return;
    }

    const embed = new EmbedBuilder()

      .setColor(0xff4da6)

      .setTitle("🎟 Novo Repasse de PS")

      .setDescription(
        `💸 **${repasse.devedorNome}** deve pagar **${repasse.valor.toLocaleString("pt-BR")}** para **${repasse.credorNome}**`
      )

      .addFields(

        {
          name: "👤 Player",
          value: repasse.player || "Não informado",
          inline: true
        },

        {
          name: "🎟 PS",
          value: repasse.pass || "Não informado",
          inline: true
        },

        {
          name: "📌 Status",
          value: "🔴 Pendente",
          inline: true
        }

      )

      .setFooter({
        text: "Chiqueirinho Avaloniano"
      })

      .setTimestamp();

    await canal.send({
      embeds: [embed]
    });

  } catch (err) {

    console.log("❌ Erro ao enviar embed:");
    console.log(err);

  }

}

/* ========================================= */
/* LOGIN DO BOT */
/* ========================================= */

if (
  process.env.DISCORD_BOT_TOKEN &&
  process.env.DISCORD_BOT_TOKEN !== "COLOQUE_O_TOKEN_DO_BOT"
) {

  bot.login(process.env.DISCORD_BOT_TOKEN)
    .then(() => {

      console.log("✅ Login do bot realizado.");

    })
    .catch(err => {

      console.log("❌ Token inválido:");
      console.log(err);

    });

} else {

  console.log(
    "⚠️ Bot sem token válido. Backend rodando sem Discord bot."
  );

}

module.exports = {
  avisarRepasse
};