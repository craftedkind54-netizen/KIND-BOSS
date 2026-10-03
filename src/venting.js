const {
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
} = require('discord.js');

const client = global.__KIND_BOSS_CLIENT;
const GUILD_ID = process.env.GUILD_ID || '1555704317552361563';
const VENTING_CHANNEL_ID = process.env.VENTING_CHANNEL_ID || '1555993876181815296';
const VENT_CREATE_CHANNEL_ID = process.env.VENT_CREATE_CHANNEL_ID || '1555994016766628001';
const SUPPORT_CHANNEL_ID = process.env.TICKET_PANEL_CHANNEL_ID || '1555835101408010281';

const PANEL_BUTTON_ID = 'kindboss_vent_create';
const MODAL_ID = 'kindboss_vent_modal';
const VENT_INPUT_ID = 'kindboss_vent_text';

function panelEmbed() {
  return new EmbedBuilder()
    .setTitle('💭 Anonymous Venting')
    .setDescription(
      `Need to let something out? You can submit a vent anonymously.\n\n` +
      `**Keep the focus on how you feel — not who you're upset with.**\n\n` +
      `✅ Vent about your feelings or a situation.\n` +
      `❌ Do not use names, usernames, @mentions, Discord IDs, or identifying hints.\n` +
      `❌ Do not attack, accuse, threaten, or target another member.\n\n` +
      `If the situation is serious enough that you need to identify someone, use <#${SUPPORT_CHANNEL_ID}> to speak with staff privately.`
    )
    .setFooter({ text: 'Vent about the situation — not the person.' });
}

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PANEL_BUTTON_ID)
      .setLabel('Vent Anonymously')
      .setEmoji('💭')
      .setStyle(ButtonStyle.Primary)
  );
}

async function ensurePanel() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(VENT_CREATE_CHANNEL_ID);
  if (!channel?.isTextBased()) throw new Error('Create-a-vent channel not found or not text based.');

  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = messages.find(m =>
    m.author.id === client.user.id &&
    m.components.some(row => row.components.some(c => c.customId === PANEL_BUTTON_ID))
  );

  if (existing) {
    await existing.edit({ embeds: [panelEmbed()], components: [panelRow()] });
  } else {
    await channel.send({ embeds: [panelEmbed()], components: [panelRow()] });
  }
}

function containsDirectIdentifier(text) {
  if (/<@!?\d+>/.test(text) || /<@&\d+>/.test(text)) return true;
  if (/\b\d{17,20}\b/.test(text)) return true;
  return false;
}

async function containsMemberName(guild, text) {
  const normalized = text.toLowerCase();
  await guild.members.fetch();
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const candidates = [member.user.username, member.displayName]
      .filter(Boolean)
      .map(v => v.trim().toLowerCase())
      .filter(v => v.length >= 4);
    for (const name of candidates) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(normalized)) return true;
    }
  }
  return false;
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === PANEL_BUTTON_ID) {
      const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle('Anonymous Vent');
      const input = new TextInputBuilder()
        .setCustomId(VENT_INPUT_ID)
        .setLabel('What do you need to let out?')
        .setPlaceholder('Talk about the situation and how you feel. Do not name anyone.')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(1500);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
      const text = interaction.fields.getTextInputValue(VENT_INPUT_ID).trim();
      const guild = interaction.guild;

      if (containsDirectIdentifier(text) || await containsMemberName(guild, text)) {
        await interaction.reply({
          content: `❌ Your vent appears to identify another member. Please remove names, usernames, @mentions, IDs, or identifying details. If you need to identify someone, use <#${SUPPORT_CHANNEL_ID}> and speak with staff privately.`,
          ephemeral: true,
        });
        return;
      }

      const feed = await guild.channels.fetch(VENTING_CHANNEL_ID);
      if (!feed?.isTextBased()) throw new Error('Venting feed channel not found or not text based.');

      const embed = new EmbedBuilder()
        .setTitle('💭 Anonymous Vent')
        .setDescription(text)
        .setFooter({ text: 'Please respond with kindness. The sender is anonymous.' })
        .setTimestamp();

      await feed.send({ embeds: [embed], allowedMentions: { parse: [] } });
      await interaction.reply({ content: `✅ Your vent was posted anonymously in <#${VENTING_CHANNEL_ID}>.`, ephemeral: true });
    }
  } catch (error) {
    console.error('Venting interaction error:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Something went wrong while submitting your vent. Please try again.', ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async message => {
  if (message.channelId !== VENTING_CHANNEL_ID || message.author.bot) return;
  const canManage = message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages);
  if (!canManage) await message.delete().catch(() => {});
});

client.once(Events.ClientReady, async () => {
  try {
    await ensurePanel();
    console.log('✅ Anonymous venting system ready.');
  } catch (error) {
    console.error('❌ Venting startup error:', error);
  }
});
