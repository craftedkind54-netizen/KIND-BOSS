'use strict';
// Support panel forms: complaint, player report, server poll request and staff question.
// A submitted form is posted to a staff queue channel. No ticket channel exists until a
// staff member presses "Open Ticket"; that staff member and the player are the only
// people in it until someone presses "Add Staff". Requests for a specific staff member
// can only be opened by that staff member (or Owner/Co-Owner). Complaints about staff
// go to a leadership-only channel.
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags, Events, LabelBuilder, FileUploadBuilder,
} = require('discord.js');

const TYPES = {
  complaint: { label: 'Make a Complaint', emoji: '📝', channel: 'complaints', title: '📝 Complaint', color: 0xe67e22, blurb: 'Tell staff about a problem on the server.' },
  report: { label: 'Report a Player', emoji: '🚨', channel: 'player-reports', title: '🚨 Player Report', color: 0xe74c3c, blurb: 'Report a player or Discord user who broke the rules.' },
  poll: { label: 'Request a Server Poll', emoji: '📊', channel: 'poll-requests', title: '📊 Server Poll Request', color: 0x9b59b6, blurb: 'Suggest a poll for the whole server to vote on.' },
  question: { label: 'Ask Staff a Question', emoji: '❓', channel: 'staff-questions', title: '❓ Staff Question', color: 0x3498db, blurb: 'Ask staff anything in private.' },
};
const LEADER_CHANNEL = 'staff-complaints';
const CHANNEL_EMOJI = { complaints: '📝', 'player-reports': '🚨', 'poll-requests': '📊', 'staff-questions': '❓', 'staff-complaints': '🔒' };
// Matches the server's naming style, e.g. 📋・application-log
const displayName = base => `${CHANNEL_EMOJI[base]}・${base}`;
const LEADER_ONLY = new Set(['staff-complaints', 'poll-requests']);
const baseOf = name => name.replace(/^[^a-z0-9]+/, '');
// [id, label (max 45), style, maxLength, required, placeholder (max 100)]
const FIELDS = {
  complaint: [
    ['subject', 'What is your complaint about?', 'Short', 100, true, ''],
    ['details', 'What happened?', 'Paragraph', 1000, true, 'Explain what happened, when, and who was involved.'],
    ['wanted', 'What would you like staff to do?', 'Paragraph', 500, false, ''],
    ['files', 'Upload files (optional)', 'File', 10, false, 'Screenshots or clips that show what happened.'],
  ],
  report: [
    ['who', 'Who are you reporting?', 'Short', 100, true, 'Minecraft name and/or Discord username'],
    ['where', 'Where did it happen?', 'Short', 100, true, 'Minecraft or Discord (channel / location)'],
    ['what', 'What did they do?', 'Paragraph', 1000, true, ''],
    ['files', 'Upload your evidence', 'File', 10, false, 'Video is best. Minecraft chat or Discord messages: screenshots.'],
    ['evidence', 'Video link (if too big to upload)', 'Short', 300, false, 'YouTube, Medal or a Discord message link'],
  ],
  poll: [
    ['question', 'Poll question', 'Short', 300, true, ''],
    ['options', 'Answer options (one per line)', 'Paragraph', 800, true, 'Yes\nNo'],
    ['why', 'Why should the server vote on this?', 'Paragraph', 800, false, ''],
  ],
  question: [
    ['question', 'What is your question?', 'Paragraph', 1000, true, ''],
  ],
};
const EVIDENCE_TIP = '**Best evidence:** a **video** 🎥. For Minecraft chat or Discord messages, use **screenshots** 📸.\nYou can drop files straight into the form. If a video is too big, paste a link (YouTube, Medal, etc.).';

function parseMeta(message) {
  const text = message?.embeds?.[0]?.footer?.text || '';
  const get = key => (text.match(new RegExp(`${key}=([^|\\s]+)`)) || [])[1] || null;
  return { type: get('type'), user: get('user'), target: get('target') };
}

module.exports = function setupSupportForms(d) {
  const { client, GUILD_ID, OWNER_ROLE_ID, CO_OWNER_ROLE_ID, STAFF_ROLE_IDS, CLOSED_TICKET_LOG_CHANNEL_ID } = d;
  const channelIds = new Map();
  const leader = m => !!m && [OWNER_ROLE_ID, CO_OWNER_ROLE_ID].some(id => id && m.roles.cache.has(id));
  const eph = (i, content) => (i.deferred || i.replied
    ? i.followUp({ content, flags: MessageFlags.Ephemeral })
    : i.reply({ content, flags: MessageFlags.Ephemeral }));

  function panelEmbed() {
    return new EmbedBuilder()
      .setTitle('🎫 Kind SMP Support')
      .setDescription([
        'Need help? Choose an option below and fill out the short form.',
        '',
        ...Object.values(TYPES).map(t => `${t.emoji} **${t.label}**\n${t.blurb}`),
        '',
        '👤 You can ask for a **specific staff member**. Your private ticket opens when a staff member picks up your request, and only they can see it unless they add more staff.',
      ].join('\n'))
      .setColor(0x3498db)
      .setFooter({ text: 'Kind SMP Support System' });
  }
  function panelRows() {
    const style = { complaint: ButtonStyle.Primary, report: ButtonStyle.Danger, poll: ButtonStyle.Secondary, question: ButtonStyle.Success };
    return [new ActionRowBuilder().addComponents(...Object.entries(TYPES).map(([k, t]) =>
      new ButtonBuilder().setCustomId(`sf:new:${k}`).setLabel(t.label).setEmoji(t.emoji).setStyle(style[k])))];
  }

  // ---------- staff queue channels ----------
  function findStaffCategory(guild) {
    if (process.env.SUPPORT_FORMS_CATEGORY_ID) return guild.channels.cache.get(process.env.SUPPORT_FORMS_CATEGORY_ID) || null;
    return guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().replace(/[^a-z]/g, '') === 'staff') || null;
  }
  async function ensureChannel(guild, name, leadersOnly) {
    const known = channelIds.get(name);
    const cached = known && guild.channels.cache.get(known);
    if (cached) return cached;
    // Find by base name so channels made before emojis were added get renamed, not duplicated.
    let ch = guild.channels.cache.find(c => c.type === ChannelType.GuildText && baseOf(c.name) === name);
    if (ch && ch.name !== displayName(name)) await ch.setName(displayName(name), 'Add emoji to support queue channel').catch(e => console.error('Rename support channel error:', e));
    leadersOnly = leadersOnly || LEADER_ONLY.has(name);
    const roles = await guild.roles.fetch();
    const viewer = leadersOnly ? [OWNER_ROLE_ID, CO_OWNER_ROLE_ID] : STAFF_ROLE_IDS;
    const allow = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.SendMessages];
    const overwrites = [{ id: guild.roles.everyone.id, type: 0, deny: [PermissionsBitField.Flags.ViewChannel] }];
    for (const id of new Set(viewer.filter(Boolean))) if (id !== guild.id && roles.has(id)) overwrites.push({ id, type: 0, allow });
    overwrites.push({ id: client.user.id, type: 1, allow: [...allow, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.ManageMessages] });
    // Leader-only channels made earlier with staff access are locked down on startup.
    if (ch && leadersOnly) await ch.permissionOverwrites.set(overwrites, 'Owner/Co-Owner only').catch(e => console.error('Lock support channel error:', e));
    if (!ch) {
      const parent = findStaffCategory(guild);
      ch = await guild.channels.create({
        name: displayName(name), type: ChannelType.GuildText, parent: parent?.id, permissionOverwrites: overwrites,
        topic: name === 'poll-requests' ? 'Server poll requests. Owner/Co-Owner only.' : leadersOnly ? 'Complaints about staff members. Owner/Co-Owner only.' : 'Support requests from the support panel.',
        reason: 'Support forms queue channel',
      });
      console.log(`✅ Created support queue channel #${displayName(name)}`);
    }
    channelIds.set(name, ch.id);
    return ch;
  }
  async function ensureAll(guild) {
    for (const t of Object.values(TYPES)) await ensureChannel(guild, t.channel, false);
    await ensureChannel(guild, LEADER_CHANNEL, true);
  }

  // ---------- form building ----------
  function modalFor(type, target) {
    const t = TYPES[type];
    const modal = new ModalBuilder().setCustomId(`sf:submit:${type}:${target}`).setTitle(t.label);
    for (const [id, label, style, max, required, placeholder] of FIELDS[type]) {
      const wrap = new LabelBuilder().setLabel(label);
      if (style === 'File') {
        // Drop box: players drag files straight into the form.
        if (placeholder) wrap.setDescription(placeholder);
        wrap.setFileUploadComponent(new FileUploadBuilder().setCustomId(id).setMinValues(1).setMaxValues(max).setRequired(required));
      } else {
        const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle[style]).setMaxLength(max).setRequired(required);
        if (placeholder) input.setPlaceholder(placeholder);
        wrap.setTextInputComponent(input);
      }
      modal.addLabelComponents(wrap);
    }
    return modal;
  }
  // Step 1: buttons only. "Request Specific Staff" swaps in the staff list.
  function chooseStaffStep(i, type) {
    const buttons = [
      new ButtonBuilder().setCustomId(`sf:choose:${type}`).setLabel('Request Specific Staff').setEmoji('👤').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`sf:any:${type}`).setLabel('Any Staff Member').setEmoji('🛡️').setStyle(ButtonStyle.Success),
    ];
    if (type === 'complaint') buttons.push(new ButtonBuilder().setCustomId('sf:lead:complaint').setLabel('Complaint About a Staff Member').setEmoji('🔒').setStyle(ButtonStyle.Danger));
    const extra = type === 'complaint'
      ? '\n\n🔒 If your complaint is **about a staff member**, press **Complaint About a Staff Member**. Only the Owner and Co-Owner will see it.'
      : type === 'report' ? `\n\n${EVIDENCE_TIP}` : '';
    return i.reply({
      content: `${TYPES[type].emoji} **${TYPES[type].label}**\nWho should handle this? Press **Request Specific Staff** to pick someone, or **Any Staff Member**.${extra}`,
      components: [new ActionRowBuilder().addComponents(...buttons)], flags: MessageFlags.Ephemeral,
    });
  }
  async function staffListStep(i, type) {
    const staff = (await d.refreshStaffCache(i.guild)).slice(0, 25);
    if (!staff.length) return i.update({ content: '❌ No staff members could be found. Press **Any Staff Member** instead.', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`sf:any:${type}`).setLabel('Any Staff Member').setEmoji('🛡️').setStyle(ButtonStyle.Success))] });
    return i.update({
      content: `${TYPES[type].emoji} **${TYPES[type].label}**\n👤 Choose the staff member you want:`,
      components: [
        new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`sf:pick:${type}`).setPlaceholder('Choose a staff member')
          .addOptions(staff.map(m => ({ label: m.displayName.slice(0, 100), description: d.getStaffRoleName(m), value: m.id })))),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`sf:any:${type}`).setLabel('Any Staff Member Instead').setEmoji('🛡️').setStyle(ButtonStyle.Secondary)),
      ],
    });
  }
  function submissionEmbed(type, user, target, values) {
    const t = TYPES[type];
    const handler = type === 'poll' ? '🔒 Owner/Co-Owner' : target === 'lead' ? '🔒 Owner/Co-Owner only (about a staff member)' : target === 'any' ? 'Any staff member' : `<@${target}> (requested)`;
    const embed = new EmbedBuilder().setTitle(t.title).setColor(t.color)
      .setDescription(`**From:** <@${user.id}> (${user.username})\n**Handled by:** ${handler}\n**Status:** 🕒 Waiting for staff`)
      .setFooter({ text: `sf|type=${type}|user=${user.id}|target=${target}` })
      .setTimestamp();
    for (const [id, label] of FIELDS[type]) {
      const v = (values[id] || '').trim();
      if (v) embed.addFields({ name: label, value: v.slice(0, 1024) });
    }
    return embed;
  }
  function queueRows() {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sf:open').setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('sf:log').setLabel('Send to Ticket Log').setEmoji('📁').setStyle(ButtonStyle.Secondary))];
  }
  function withStatus(message, status) {
    const embed = EmbedBuilder.from(message.embeds[0]);
    embed.setDescription((embed.data.description || '').replace(/\*\*Status:\*\*.*$/m, `**Status:** ${status}`));
    return embed;
  }
  function canHandle(member, meta) {
    if (!d.isStaff(member) && !leader(member)) return '❌ Staff only.';
    if (meta.type === 'poll' && !leader(member)) return '❌ Only the Owner or Co-Owner can handle poll requests.';
    if (meta.target === 'lead' && !leader(member)) return '❌ Only the Owner or Co-Owner can handle complaints about staff.';
    if (meta.target && !['any', 'lead'].includes(meta.target) && meta.target !== member.id && !leader(member)) return `❌ This request is for <@${meta.target}>. Only they (or the Owner/Co-Owner) can pick it up.`;
    return null;
  }

  // ---------- interactions ----------
  async function handle(i) {
    const id = i.customId;
    if (id.startsWith('sf:new:')) { const type = id.split(':')[2]; if (!TYPES[type]) return; if (type === 'poll') return i.showModal(modalFor('poll', 'any')); return chooseStaffStep(i, type); }
    if (id.startsWith('sf:choose:')) { const type = id.split(':')[2]; if (!TYPES[type]) return; return staffListStep(i, type); }
    if (id.startsWith('sf:pick:') && i.isStringSelectMenu()) return i.showModal(modalFor(id.split(':')[2], i.values[0]));
    if (id.startsWith('sf:any:')) return i.showModal(modalFor(id.split(':')[2], 'any'));
    if (id === 'sf:lead:complaint') return i.showModal(modalFor('complaint', 'lead'));

    if (id.startsWith('sf:submit:') && i.isModalSubmit()) {
      const [, , type, target] = id.split(':');
      if (!TYPES[type]) return;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const textFields = FIELDS[type].filter(f => f[2] !== 'File');
      const values = Object.fromEntries(textFields.map(([fid]) => [fid, i.fields.getTextInputValue(fid) || '']));
      const uploads = FIELDS[type].filter(f => f[2] === 'File')
        .flatMap(([fid]) => [...(i.fields.getUploadedFiles(fid)?.values() || [])]);
      const channel = await ensureChannel(i.guild, target === 'lead' ? LEADER_CHANNEL : TYPES[type].channel, target === 'lead');
      const specific = !['any', 'lead'].includes(target);
      const embed = submissionEmbed(type, i.user, target, values);
      if (uploads.length) embed.addFields({ name: '📎 Uploaded files', value: `${uploads.length} file(s) attached below.` });
      const payload = {
        content: specific ? `<@${target}>, a player requested you for this.` : undefined,
        embeds: [embed],
        components: queueRows(),
        allowedMentions: { users: specific ? [target] : [] },
      };
      // Re-upload the files so they stay on the staff post (form upload links expire).
      // If they are too big for this server's upload limit, post the links instead.
      const files = uploads.map(a => ({ attachment: a.url, name: a.name }));
      let tooBig = false;
      try { await channel.send({ ...payload, files }); } catch (e) {
        if (!files.length) throw e;
        tooBig = true;
        embed.spliceFields(-1, 1, { name: '📎 Uploaded files (links, may expire)', value: uploads.map(a => `[${a.name}](${a.url})`).join('\n').slice(0, 1024) });
        await channel.send(payload);
      }
      return i.editReply({ content: `✅ Your ${{ complaint: 'complaint', report: 'report', poll: 'poll request', question: 'question' }[type]} was sent to staff${uploads.length ? ` with ${uploads.length} file(s)` : ''}. You will get a private ticket when ${specific ? `<@${target}>` : 'a staff member'} picks it up.${tooBig ? '\n⚠️ Your files were too big to copy, so please upload them again in your ticket.' : ''}` });
    }

    if ((id === 'sf:open' || id === 'sf:log') && i.isButton()) {
      const meta = parseMeta(i.message);
      if (!meta.type || !meta.user) return eph(i, '❌ This request could not be read.');
      const denied = canHandle(i.member, meta);
      if (denied) return eph(i, denied);
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      if (id === 'sf:log') {
        const log = await i.guild.channels.fetch(CLOSED_TICKET_LOG_CHANNEL_ID).catch(() => null);
        if (!log) return i.editReply('❌ The ticket log channel could not be found.');
        const embed = withStatus(i.message, `📁 Sent to ticket log by <@${i.user.id}> (no ticket opened)`);
        const files = [...(i.message.attachments?.values() || [])].map(a => ({ attachment: a.url, name: a.name }));
        await log.send({ embeds: [embed], files }).catch(() => log.send({ embeds: [embed] }));
        await i.message.edit({ embeds: [embed], components: [] });
        return i.editReply('📁 Sent to the ticket log.');
      }

      const applicant = await i.guild.members.fetch(meta.user).catch(() => null);
      if (!applicant) return i.editReply('❌ That player is no longer in the server. You can send this to the ticket log instead.');
      const result = await d.createTicket({ guild: i.guild, member: applicant, type: `form_${meta.type}`, allowedUsers: [i.user.id] });
      if (!result.success) return i.editReply(result.message || '❌ The ticket could not be created.');
      const ticket = result.channel;
      const copy = EmbedBuilder.from(i.message.embeds[0]);
      copy.setDescription((copy.data.description || '').replace(/\*\*Status:\*\*.*$/m, `**Picked up by:** <@${i.user.id}>`));
      const ticketPost = withFiles => ticket.send({
        content: `<@${i.user.id}> is handling your request, <@${applicant.id}>.${meta.type === 'report' ? '\nYou can upload screenshots or videos here.' : ''}`,
        embeds: [copy],
        files: withFiles ? [...(i.message.attachments?.values() || [])].map(a => ({ attachment: a.url, name: a.name })) : [],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sf:addStaff').setLabel('Add Staff Member').setEmoji('➕').setStyle(ButtonStyle.Primary))],
        allowedMentions: { users: [i.user.id, applicant.id] },
      });
      // Files go with the request into the ticket; if they can't be copied, staff still see them on the queue post.
      await ticketPost(true).catch(() => ticketPost(false)).catch(e => console.error('Support form ticket post error:', e));
      await i.message.edit({ embeds: [withStatus(i.message, `🟢 Ticket opened by <@${i.user.id}>: ${ticket}`)], components: [] });
      return i.editReply(`✅ Ticket opened: ${ticket}`);
    }

    if (id === 'sf:addStaff' && i.isButton()) {
      if (!d.isStaff(i.member) && !leader(i.member)) return eph(i, '❌ Only staff in this ticket can add staff.');
      return i.reply({
        content: '➕ Choose staff to add to this ticket:',
        components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('sf:addStaffPick').setPlaceholder('Choose staff members').setMinValues(1).setMaxValues(5))],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (id === 'sf:addStaffPick' && i.isUserSelectMenu()) {
      if (!d.isStaff(i.member) && !leader(i.member)) return eph(i, '❌ Staff only.');
      const added = [], skipped = [];
      for (const uid of i.values) {
        const m = await i.guild.members.fetch(uid).catch(() => null);
        if (!m || m.user.bot || !(d.isStaff(m) || leader(m))) { skipped.push(uid); continue; }
        await i.channel.permissionOverwrites.edit(uid, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true });
        added.push(uid);
      }
      if (added.length) await i.channel.send({ content: `➕ <@${i.user.id}> added ${added.map(u => `<@${u}>`).join(', ')} to this ticket.`, allowedMentions: { users: added } });
      return i.update({ content: `${added.length ? `✅ Added ${added.map(u => `<@${u}>`).join(', ')}.` : 'Nobody was added.'}${skipped.length ? `\n⚠️ Not staff, skipped: ${skipped.map(u => `<@${u}>`).join(', ')}` : ''}`, components: [] });
    }
  }

  client.on(Events.InteractionCreate, async i => {
    if (typeof i.customId !== 'string' || !i.customId.startsWith('sf:') || !i.guild || i.guild.id !== GUILD_ID) return;
    try { await handle(i); } catch (e) {
      console.error('Support form error:', e);
      try { await eph(i, '❌ Something went wrong. Please try again or contact staff.'); } catch {}
    }
  });
  client.once(Events.ClientReady, async () => {
    try { const guild = await client.guilds.fetch(GUILD_ID); await guild.channels.fetch(); await ensureAll(guild); }
    catch (e) { console.error('Support forms channel setup error:', e); }
  });

  return { panelEmbed, panelRows, parseMeta, TYPES, FIELDS };
};
module.exports.parseMeta = parseMeta;
module.exports.TYPES = TYPES;
module.exports.FIELDS = FIELDS;
