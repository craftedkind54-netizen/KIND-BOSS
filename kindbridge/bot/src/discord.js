import { Client, GatewayIntentBits, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder,
  EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { submit, decide, joining } from './applications.js';
import { quotaDay, channelTarget } from './youtube.js';
import { createNotifications } from './notifications.js';
import { isOwnedApplicationPanel } from './applicationPanelPolicy.js';
import { createHash } from 'node:crypto';

const ephemeral = MessageFlags.Ephemeral;
const button = (id, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
function form(id, title, fields) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addLabelComponents(fields.map(([key, label, max, long, required = true, description]) => {
    const field = new LabelBuilder().setLabel(label).setTextInputComponent(new TextInputBuilder().setCustomId(key).setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(max).setRequired(required));
    if (description) field.setDescription(description);
    return field;
  }));
}
export const applicationForm = (edition, reapply = false) => form(`${reapply ? 'application-reapply' : 'application-single'}:${edition}`, 'Kind SMP application', [
  ['username', edition === 'java' ? 'Minecraft Java username' : 'Xbox gamertag (no Floodgate prefix)', 16, false, true,
    'By submitting this application, you agree to follow the SMP rules.'],
  ['age', 'How old are you? (13 or older)', 3],
  ['heard', 'How did you hear about us?', 1000, true],
  ['why', 'Why do you want to join?', 1000, true],
  ['youtube', 'YouTube channel link (optional)', 200, false, false]
]);
function applicationPanelBody(c) {
  return {
    content: `## Welcome to Kind SMP\nApply to join our Java and Bedrock SMP. You must be **13 or older**.\nRead <#${c.rules}> first. Answers are shared with staff in a private review channel.\nNew Minecraft account or need to correct a name? Use /apply. If an approved account was not added to the whitelist, use /status and choose Reapply for Java or Bedrock. A reapplication cancels the old pending whitelist request and goes to staff for approval. One application can await review at a time. If rejected, correct your answers and use /apply again right away.\nApply and add your optional YouTube channel in one form. By submitting, you agree to follow the SMP rules. The supplied channel is linked automatically after staff approval and whitelisting.`,
    components: [row(button('edition:java','Apply · Java'), button('edition:bedrock','Apply · Bedrock'))]
  };
}
function bountyContent(row, c, state = row.state, result = {}) {
  const data = JSON.parse(row.payload);
  const rewardItems = (data.items || []).map(item => `${item.amount} × ${item.name || item.material}`).join('\n') || 'No item reward';
  const embed = new EmbedBuilder().setColor(state === 'active' ? 0xf1b83b : state === 'claimed' ? 0x57f287 : 0x777777)
    .setTitle(`Kind SMP bounty · ${row.id.slice(0,8)}`)
    .setDescription(`**Target:** ${row.target_name}\n**Posted by:** ${row.poster_name}\n**Kill-level reward:** ${data.levels}`)
    .addFields({name:'Type',value:data.ownerEvent ? 'Owner event bounty' : 'Player bounty'},{name:'Items in escrow',value:rewardItems},{name:'Expires',value:`<t:${Math.floor(row.expires/1000)}:F>`})
    .setThumbnail(`https://mc-heads.net/avatar/${row.target_uuid}/128`);
  const first = (data.items || []).find(item => item.material);
  if (first) {
    const texture = String(first.material).toLowerCase();
    embed.setImage(`https://mcasset.cloud/1.21.11/assets/minecraft/textures/item/${encodeURIComponent(texture)}.png`);
  }
  const files=[], embeds=[embed];
  for (const [index,item] of (data.items || []).slice(0,data.levelsIcon ? 8 : 9).entries()) {
    let image;
    if (item.icon && /^[A-Za-z0-9+/=]+$/.test(item.icon)) {
      const filename=`bounty-item-${index}.png`;
      files.push(new AttachmentBuilder(Buffer.from(item.icon,'base64'),{name:filename}));
      image=`attachment://${filename}`;
    } else if (item.material) {
      image=`https://mcasset.cloud/1.21.11/assets/minecraft/textures/item/${encodeURIComponent(String(item.material).toLowerCase())}.png`;
    }
    if (image) embeds.push(new EmbedBuilder().setColor(0x9b59b6).setTitle(`${item.amount} × ${item.name || item.material}`).setImage(image));
  }
  if (data.levelsIcon && /^[A-Za-z0-9+/=]+$/.test(data.levelsIcon)) {
    const filename='bounty-kill-level-token.png';
    files.push(new AttachmentBuilder(Buffer.from(data.levelsIcon,'base64'),{name:filename}));
    embeds.push(new EmbedBuilder().setColor(0xe6b422).setTitle(`${data.levels} kill levels`).setImage(`attachment://${filename}`));
  }
  if (state === 'claimed') embed.addFields({name:'Result',value:`Claimed by ${result.winnerName || 'a player'}`});
  else if (state === 'expired') embed.addFields({name:'Result',value:result.winnerName ? `Expired after the target survived; reward delivered to ${result.winnerName}.` : 'The bounty expired.'});
  else if (state === 'refunded') embed.addFields({name:'Result',value:`Expired; reward returned to ${row.poster_name}.`});
  else if (state === 'rejected') embed.addFields({name:'Result',value:'Not approved by staff.'});
  else if (state === 'cancelled') embed.addFields({name:'Result',value:`Withdrawn by ${row.poster_name}; escrow returned.`});
  return {embeds,files};
}

const reapplyButtons = () => row(button('reapply:java','Reapply · Java'), button('reapply:bedrock','Reapply · Bedrock'));
// Only used to finish drafts opened before the single-form update.
const youtubeForm = () => form('application:youtube', 'Kind SMP application · 2 of 2', [['youtube', 'YouTube channel link (optional)', 200, false, false]]);

export function createDiscord(store, c, yt, sharedClient = null) {
  const client = sharedClient || new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] } });
  const notifications = createNotifications(store, c, client);
  async function staff(i) {
    if (i.guildId !== c.guild) throw new Error('Use this command in the Kind SMP Discord server.');
    const member = await i.guild.members.fetch({ user: i.user.id, force: true });
    if (!c.staffRoles.some(id => member.roles.cache.has(id))) throw new Error('Only the configured Kind SMP staff role can do that.');
  }
  async function send(channelId, body, key = null, { mentionEveryone = false } = {}) {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.guildId !== c.guild || !channel.send) throw new Error('Configured channel is unavailable.');
    if (channelId === c.log) {
      for (const roleId of [c.guild,c.memberRole,c.youtubeRole]) {
        const role = await channel.guild.roles.fetch(roleId);
        if (role && channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) throw new Error('Make the form-log channel private: everyone, SMP Member and YouTuber must not have View Channel. Give access to staff and the bot.');
      }
    }
    const nonce = key ? createHash('sha256').update(key).digest('hex').slice(0,24) : undefined;
    return channel.send({ ...body, ...(nonce ? {nonce, enforceNonce: true} : {}), allowedMentions: { parse: mentionEveryone ? ['everyone'] : [] } });
  }
  const uneditableMessageCodes = new Set(['10008', '50005', '50001', '50013']);
  function applicationOutcome(app) {
    if (app.state === 'rejected') return `Rejected by <@${app.reviewer}>${app.reason ? ': ' + app.reason : ''}`;
    if (app.state === 'cancelled') return 'Cancelled because the applicant is no longer a member of this Discord server. They were asked to rejoin and apply again by DM.';
    if (app.state === 'superseded') return 'Replaced by a newer accepted account. Staff: remove the previous Minecraft whitelist entry if needed.';
    if (app.state === 'ready') return `Approved by <@${app.reviewer}>. Minecraft whitelist: complete.`;
    return `Approved by <@${app.reviewer}>. Minecraft whitelist: pending; request is saved until the server processes it.`;
  }
  function applicationStatusBody(app) {
    const embed = new EmbedBuilder().setColor(0x65b891)
      .setTitle(`Application status · ${app.id.slice(0,8)}`)
      .setDescription(`Applicant: <@${app.user_id}>\nMinecraft account: ${app.edition} · ${app.username}\n${applicationOutcome(app)}`);
    if (app.state === 'rejected' && app.reason) embed.addFields({name:'Reason',value:app.reason});
    return {content:`Application ${app.id.slice(0,8)} status for <@${app.user_id}>`, embeds:[embed], components:[], allowedMentions:{parse:[]}};
  }
  async function reportMemberRoleFailure(app, error, origin) {
    const code = String(error.code || 'error');
    if (code === '10007') {
      const changed = store.transaction(() => {
        const result = store.run("UPDATE applications SET state='cancelled',reason=?,decided=?,role_done=1,notification_done=0 WHERE id=? AND state IN ('approved','ready')", 'Applicant is no longer a member of the Discord server (Discord 10007). Rejoin and use /apply to submit a new application.', Date.now(), app.id);
        if (!result.changes) return false;
        store.run("UPDATE jobs SET state='cancelled',lease=NULL WHERE kind='whitelist' AND state IN ('queued','leased') AND json_extract(payload,'$.applicationId')=?", app.id);
        return true;
      });
      if (!changed) return {cancelled:false,dmSent:false};

      let dmSent = false;
      try {
        const user = await client.users.fetch(app.user_id);
        await user.send('Your Kind SMP application was cancelled because we could not find you in the Discord server. Please rejoin the server, then use /apply to submit a new application. Staff approval is required again.');
        dmSent = true;
      } catch (dmError) {
        store.set('discordError', `Application ${app.id.slice(0,8)} was cancelled, but its reapply DM could not be delivered (Discord ${dmError.code || 'error'}).`);
        console.error(`Could not DM applicant for cancelled application ${app.id.slice(0,8)}:`, dmError.message || dmError);
      }
      store.set(`memberRoleFailureNotice:${app.id}`, {code, sentAt:Date.now(), cancelled:true, dmSent});
      try {
        await send(c.log, {content:`Application ${app.id.slice(0,8)} cancelled: Discord could not find the applicant in the server. Reapply DM ${dmSent ? 'sent' : 'could not be delivered'}. (while ${origin})`}, `application-cancelled:${app.id}`);
      } catch (postError) {
        console.error(`Could not post cancellation for application ${app.id.slice(0,8)}:`, postError.message || postError);
      }
      return {cancelled:true,dmSent};
    }
    const detail = code === '50013' ? 'Move the bot role above SMP Members and grant Manage Roles.' : 'Check the bot role and server permissions.';
    const message = `Member role failed for application ${app.id.slice(0,8)} (Discord ${code}).`;
    store.set('discordError', message + ' ' + detail);
    console.error(message, error.message || error);
    const key = `memberRoleFailureNotice:${app.id}`;
    const prior = store.get(key, {});
    if (prior.code === code && Date.now() - (prior.sentAt || 0) < 15 * 60 * 1000) return;
    try {
      await send(c.log, {content:`⚠️ ${message} Applicant: <@${app.user_id}>. ${detail} (while ${origin})`});
      store.set(key, {code, sentAt:Date.now()});
    } catch (postError) {
      console.error(`Could not post member role failure for application ${app.id.slice(0,8)}:`, postError.message || postError);
      store.set(key, {code, sentAt:Date.now()});
    }
  }  const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Staff: post the Kind SMP application panel'),
    new SlashCommandBuilder().setName('apply').setDescription('Apply to join Kind SMP or apply again with a new Minecraft account'),
    new SlashCommandBuilder().setName('join').setDescription('Privately DM me the server address and joining instructions'),
    new SlashCommandBuilder().setName('resend-welcome').setDescription('Staff: resend a member’s private server-address DM').addUserOption(o=>o.setName('member').setDescription('Approved member').setRequired(true)),
    new SlashCommandBuilder().setName('status').setDescription('Check your application and joining instructions'),
    new SlashCommandBuilder().setName('youtube').setDescription('Check your automatically linked YouTube channel'),
    new SlashCommandBuilder().setName('link-youtube').setDescription('Staff: approve a channel link for an accepted member').addUserOption(o=>o.setName('member').setDescription('Accepted member').setRequired(true)).addStringOption(o=>o.setName('channel').setDescription('YouTube channel URL or @handle').setRequired(true)),
    new SlashCommandBuilder().setName('short').setDescription('Post a Short from your linked YouTube channel').addStringOption(o => o.setName('url').setDescription('Public YouTube Short URL').setRequired(true)),
    new SlashCommandBuilder().setName('stream').setDescription('Register your public upcoming/live stream for announcements').addStringOption(o => o.setName('url').setDescription('YouTube stream URL').setRequired(true)),
    new SlashCommandBuilder().setName('health').setDescription('Staff: check Minecraft connection, jobs and YouTube quota'),
    new SlashCommandBuilder().setName('retry').setDescription('Staff: retry a failed Minecraft job').addStringOption(o => o.setName('job').setDescription('Job ID from /health').setRequired(true)),
    new SlashCommandBuilder().setName('unlink-youtube').setDescription('Staff: remove or disable a member’s channel link').addUserOption(o => o.setName('member').setDescription('Member to unlink').setRequired(true))
  ].map(x => x.setDMPermission(false).toJSON());
  client.once('clientReady', async () => {
    try {
      const guild = await client.guilds.fetch(c.guild);
      const existing = await guild.commands.fetch();
      const merged = new Map(existing.map(command => [command.name, command.toJSON()]));
      for (const command of commands) merged.set(command.name, command);
      await guild.commands.set([...merged.values()]);
      const channel = await client.channels.fetch(c.apply);
      const body = applicationPanelBody(c);
      const storedPanelId = store.get('applicationPanel');
      const storedPanel = storedPanelId ? await channel.messages.fetch(storedPanelId).catch(() => null) : null;
      if (isOwnedApplicationPanel(storedPanel, client.user.id)) await storedPanel.edit(body);
      else {
        const message = await send(c.apply, body);
        store.set('applicationPanel', message.id);
        console.log(`[Kind SMP Applications] Published an active application panel from ${client.user.tag}.`);
      }
      console.log('Kind SMP connected. Staff can run /setup.');
    } catch (e) { console.error('Discord command or application panel setup failed:', e.message); }
  });
  const starts = new Map();
  const userLocks = new Set();
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand() && !i.isButton() && !i.isModalSubmit()) return;
    const reply = content => i.deferred || i.replied ? i.editReply({ content, components: [] }) : i.reply({ content, flags: ephemeral });
    if (i.guildId !== c.guild) return reply('Use this in the Kind SMP Discord server.');
    if (userLocks.has(i.user.id)) return reply('Your previous request is still processing.');
    userLocks.add(i.user.id);
    try {
      const id = i.customId || i.commandName;
      if (['setup','health','retry','unlink-youtube','link-youtube','resend-welcome'].includes(id) || /^(approve|reject|rejection|bounty-approve|bounty-reject|bounty-rejection):/.test(id)) {
        // Button-to-modal responses must be immediate; the staff check still uses a fresh REST fetch.
        if (!id.startsWith('reject:') && !id.startsWith('bounty-reject:')) await i.deferReply({ flags: ephemeral });
        await staff(i);
      }
      if (id === 'setup') {
        const guild = await client.guilds.fetch(c.guild), me = await guild.members.fetchMe();
        for (const roleId of [c.memberRole, c.youtubeRole]) {
          const role = await guild.roles.fetch(roleId);
          if (!role || role.managed || me.roles.highest.comparePositionTo(role) <= 0 || !me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Move the bot role above SMP Member and YouTuber, and give it Manage Roles.');
        }
        const body = applicationPanelBody(c);
        const panelId = store.get('applicationPanel');
        if (panelId) { try { const ch = await client.channels.fetch(c.apply); const m = await ch.messages.fetch(panelId); if (isOwnedApplicationPanel(m, client.user.id)) { await m.edit(body); return reply('Application panel updated.'); } } catch { /* Recreate a deleted panel. */ } }
        const msg = await send(c.apply, body); store.set('applicationPanel', msg.id); return reply('Application panel posted.');
      }
      if (id === 'apply') {
        const current = store.one("SELECT * FROM applications WHERE user_id=? AND state IN ('pending','approved') ORDER BY created DESC,rowid DESC LIMIT 1", i.user.id);
        if (current?.state === 'pending') throw new Error('Your application is waiting for staff review. Use /status for its current status.');
        if (current?.state === 'approved') return i.reply({content:`Your ${current.edition} account **${current.username}** is approved, but whitelist confirmation is still pending. If the name needs correcting or you still cannot join, choose the edition to submit a corrected application. Staff approval is required again, and the old pending whitelist request will be cancelled when you submit.`,components:[reapplyButtons()],flags:ephemeral});
        return i.reply({ content: `Read <#${c.rules}> before applying. Submitting your application confirms you agree to follow the SMP rules. Already a member with a new account? Apply again here. Your current membership stays active during review. Existing YouTube links are retained; ask staff to change your channel. Choose the account you will join with:`, components: [row(button('edition:java','Java'),button('edition:bedrock','Bedrock'))], flags: ephemeral });
      }
      if (id.startsWith('edition:')) {
        if (store.one("SELECT id FROM applications WHERE user_id=? AND state IN ('pending','approved')", i.user.id)) throw new Error('You already have an application awaiting review or whitelisting. Use /status.');
        const edition = id.split(':')[1]; if (!['java','bedrock'].includes(edition)) return;
        return i.showModal(applicationForm(edition));
      }
      if (id.startsWith('reapply:')) {
        const edition = id.split(':')[1]; if (!['java','bedrock'].includes(edition)) return;
        if (!store.one("SELECT id FROM applications WHERE user_id=? AND state='approved'", i.user.id)) throw new Error('Your approved whitelist request is no longer active. Use /apply to start or continue an application.');
        return i.showModal(applicationForm(edition, true));
      }
      if (['application-single:java','application-single:bedrock'].includes(id)) {
        const data = { edition: id.split(':')[1], rules: 'yes' };
        for (const key of ['username','age','heard','why','youtube']) data[key] = i.fields.getTextInputValue(key).trim();
        const appId = submit(store, i.user.id, data, c.cooldown);
        store.run('DELETE FROM drafts WHERE user_id=?', i.user.id);
        return reply(`Application submitted to staff. Reference: ${appId.slice(0,8)}. Use /status for updates.`);
      }
      if (['application-reapply:java','application-reapply:bedrock'].includes(id)) {
        const data = { edition: id.split(':')[1], rules: 'yes' };
        for (const key of ['username','age','heard','why','youtube']) data[key] = i.fields.getTextInputValue(key).trim();
        const appId = submit(store, i.user.id, data, c.cooldown, Date.now(), {reapplyApproved:true});
        store.run('DELETE FROM drafts WHERE user_id=?', i.user.id);
        return reply(`Corrected ${data.edition} application submitted to staff. Reference: ${appId.slice(0,8)}. The previous pending whitelist request was cancelled. Use /status for updates.`);
      }
      // Honor forms and drafts already open when the bot was upgraded.
      if (['application:java','application:bedrock'].includes(id)) {
        const data = { edition: id.split(':')[1] };
        for (const key of ['username','age','rules','heard','why']) data[key] = i.fields.getTextInputValue(key).trim();
        // Reject ineligible age before retaining the draft.
        if (!/^\d{1,3}$/.test(data.age) || Number(data.age) < 13 || Number(data.age) > 120) throw new Error('You must be at least 13 to apply.');
        store.run('INSERT INTO drafts VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,expires=excluded.expires', i.user.id, JSON.stringify(data), Date.now()+1800000);
        return i.reply({ content: 'Your unfinished form is saved for 30 minutes. Click Finish application to submit it (the YouTube link is optional). Submitted applications and approved whitelist requests do not expire while the SMP is offline.', components: [row(button('continue','Finish application'))], flags: ephemeral });
      }
      if (id === 'continue') return i.showModal(youtubeForm());
      if (id === 'application:youtube') {
        const draft = store.one('SELECT * FROM drafts WHERE user_id=?', i.user.id);
        if (!draft || draft.expires < Date.now()) throw new Error('Your draft expired. Start again with /apply.');
        const data = JSON.parse(draft.data); data.youtube = i.fields.getTextInputValue('youtube').trim();
        const appId = submit(store, i.user.id, data, c.cooldown);
        store.run('DELETE FROM drafts WHERE user_id=?', i.user.id);
        return reply(`Application submitted to staff. Reference: ${appId.slice(0,8)}. Use /status for updates.`);
      }
      if (id.startsWith('approve:')) {
        const applicationId = id.slice(8);
        decide(store,applicationId,i.user.id,true);
        const app = store.one('SELECT * FROM applications WHERE id=?',applicationId);
        try {
          const member = await i.guild.members.fetch(app.user_id);
          await member.roles.add(c.memberRole,'Kind SMP application approved');
          store.run('UPDATE applications SET role_done=1 WHERE id=?',app.id);
          store.set(`memberRoleFailureNotice:${app.id}`,null);
        } catch (error) {
          const failure = await reportMemberRoleFailure(app,error,'approving the application');
          if (failure?.cancelled) return reply(failure.dmSent
            ? 'Application cancelled because the applicant is no longer in the Discord server. A private DM asked them to rejoin and apply again.'
            : 'Application cancelled because the applicant is no longer in the Discord server. The reapply DM could not be delivered; staff were notified.');
        }
        return reply('Approved. The SMP Members role was assigned or staff were notified if Discord refused it. The whitelist request is saved with no expiry and will retry until the server confirms it.');
      }
      if (id.startsWith('reject:')) return i.showModal(form(`rejection:${id.slice(7)}`, 'Reason for rejecting', [['reason','Reason shown to the applicant',1000,true]]));
      if (id.startsWith('rejection:')) { decide(store,id.slice(10),i.user.id,false,i.fields.getTextInputValue('reason')); return reply('Application rejected with your reason.'); }
      if (id.startsWith('bounty-approve:')) {
        const bountyId=id.slice('bounty-approve:'.length), changed=store.bountyDecision(bountyId,'approve',i.user.id);
        if (!changed) throw new Error('This bounty is no longer awaiting staff review.');
        return reply('Bounty approved. It will become public after the Minecraft server confirms it.');
      }
      if (id.startsWith('bounty-reject:')) return i.showModal(form(`bounty-rejection:${id.slice('bounty-reject:'.length)}`, 'Reject bounty', [['reason','Reason for rejecting',500,true]]));
      if (id.startsWith('bounty-rejection:')) {
        const bountyId=id.slice('bounty-rejection:'.length), bounty=store.one("SELECT * FROM bounties WHERE id=? AND state='pending'",bountyId);
        if (!bounty) throw new Error('This bounty is no longer awaiting review.');
        if (!store.bountyDecision(bountyId,'reject',i.user.id)) throw new Error('This bounty is no longer awaiting review.');
        store.run('UPDATE bounties SET result=?,discord_dirty=1 WHERE id=?',JSON.stringify({reason:i.fields.getTextInputValue('reason').trim()}),bountyId);
        return reply('Bounty rejected. The Minecraft server will return the escrow to the poster.');
      }
      if (id === 'join' || id === 'resend-welcome') {
        if (!i.deferred) await i.deferReply({flags:ephemeral});
        const userId = id === 'join' ? i.user.id : i.options.getUser('member',true).id;
        const app = store.one("SELECT * FROM applications WHERE user_id=? AND state IN ('approved','ready') ORDER BY created DESC,rowid DESC LIMIT 1",userId);
        if (!app) throw new Error('A staff-approved application is required before joining details can be sent.');
        const last = store.get('dmManual:' + app.id,0);
        if (Date.now()-last < 30000) throw new Error('Wait 30 seconds before requesting another welcome DM.');
        store.set('dmManual:' + app.id,Date.now());
        const result = await notifications.deliver(app,true);
        const messages = {sent:'The server address and joining instructions were sent by private DM.', 'missing-address':'The server address for this Minecraft edition is not configured. Staff must set JAVA_ADDRESS or BEDROCK_ADDRESS in Railway.', blocked:'Discord blocked the private DM. Enable direct messages from server members and make sure the bot is not blocked, then use /join again. /status also provides a reply visible only to you.', failed:'The private DM could not be sent. A retry is queued; staff can check /health.', busy:'A private DM is already being sent. Please wait a moment.'};
        return reply(messages[result.status] || 'Please try again shortly.');
      }
      if (id === 'status') {
        const app = store.one('SELECT * FROM applications WHERE user_id=? ORDER BY created DESC, rowid DESC LIMIT 1', i.user.id);
        if (!app) return reply('You have not applied yet. Use /apply.');
        const state = { pending:'Your submitted application is saved and waiting for staff review. It does not expire after 30 minutes.',approved:`Approved by staff. Whitelist confirmation for ${app.edition} account **${app.username}** is still pending. If the name is wrong or you still cannot join, choose Reapply below. This cancels the old pending whitelist request and sends a corrected application for staff approval.`,ready:joining(c, true, app.username),rejected:`Rejected: ${app.reason}\nYou can correct your application and use /apply again right away.`,cancelled:'Your application was cancelled because you are no longer a member of the Discord server. Rejoin the server, then use /apply to apply again.' }[app.state];
        const dm = store.get(notifications.keyFor(app),{});
        const dmStatus = ['approved','ready'].includes(app.state) ? '\nPrivate DM: ' + (dm.status || (app.dm_done === 1 ? 'sent' : app.dm_done === 2 ? 'blocked' : 'queued')) + '. Use /join to send it again.' : '';
        const current = store.one("SELECT username FROM applications WHERE user_id=? AND state='ready'", i.user.id);
        const content = state + dmStatus + (current && app.state !== 'ready' ? '\nYour current account (' + current.username + ') remains accepted.' : app.state === 'ready' ? '\nGot a new Minecraft account? Use /apply to submit a new application for staff review.' : '');
        if (app.state === 'approved') return i.reply({content,components:[reapplyButtons()],flags:ephemeral});
        return reply(content);
      }
      if (id === 'youtube' || id === 'verify') {
        const creator=store.one('SELECT data FROM creators WHERE user_id=?',i.user.id);
        if (creator) return reply(`Your linked channel: ${JSON.parse(creator.data).channelUrl}\nNo verification code or description change is needed. Role assignment and scoreboard updates run automatically.`);
        const error=store.get(`youtubeLinkError:${i.user.id}`);
        return reply(error ? `Channel linking needs staff attention: ${error}` : 'YouTube links supplied in accepted applications are linked automatically after whitelisting. No verification step is required. If you left the link blank, ask staff to add it using /link-youtube.');
      }
      if (id === 'link-youtube') {
        const userId=i.options.getUser('member',true).id, url=i.options.getString('channel',true).trim();
        channelTarget(url);
        if (!store.one("SELECT id FROM applications WHERE user_id=? AND state IN ('approved','ready')",userId)) throw new Error('This member must have an approved application first.');
        if (store.one('SELECT user_id FROM creators WHERE user_id=?',userId)) throw new Error('Unlink the existing channel first with /unlink-youtube.');
        store.set(`youtubeApprovedLink:${userId}`,{url,reviewer:i.user.id});
        store.set(`youtubeDisabled:${userId}`,false);
        store.set(`youtubeLinkRetry:${userId}`,0);
        store.set(`youtubeLinkError:${userId}`,null);
        return reply('Channel link approved. It will be linked automatically after whitelisting; no member verification step is needed.');
      }
      if (['short','stream'].includes(id)) {
        await i.deferReply({ flags: ephemeral });
        const last = starts.get(i.user.id) || 0;
        if (Date.now() - last < 5000) throw new Error('Wait a few seconds before another request.'); starts.set(i.user.id,Date.now());
        await yt.submitVideo(i.user.id,i.options.getString('url',true),id === 'short'); return reply('Checked your linked channel and queued any eligible announcement. Duplicate posts are suppressed.');
      }
      if (id === 'health') {
        const seen = store.get('bridgeSeen',0), jobs = store.all("SELECT id,kind,state,attempts,error FROM jobs WHERE state NOT IN ('done','cancelled') ORDER BY rowid DESC LIMIT 10");
        return reply(`Minecraft last connected: ${seen ? `<t:${Math.floor(seen/1000)}:R>` : 'never'}\nServer addresses: Java ${c.java ? 'configured' : 'MISSING JAVA_ADDRESS'}, Bedrock ${c.bedrock ? 'configured' : 'MISSING BEDROCK_ADDRESS'}\nLast DM error: ${store.get('dmError','none')}\nYouTube units today: ${store.one('SELECT used FROM quota WHERE day=?',quotaDay())?.used || 0}/${c.dailyBudget}\nCreators: ${store.one('SELECT count(*) AS n FROM creators').n}/${c.maxCreators}\nLast Discord error: ${store.get('discordError','none')}\nLast YouTube error: ${store.get('youtubeError','none')}\nRecent unfinished jobs:\n${jobs.map(j=>`${j.id} · ${j.kind} · ${j.state} · attempts ${j.attempts}${j.error ? ' · '+j.error : ''}`).join('\n') || 'none'}`.slice(0,1950));
      }
      if (id === 'retry') { const result=store.run("UPDATE jobs SET until=0 WHERE id=? AND state='queued'",i.options.getString('job',true)); return reply(result.changes ? 'Queued job is eligible to retry. Use /health to check the result.' : 'This job is not queued for retry. For a missing Minecraft account, submit a corrected username through the application form.'); }
      if (id === 'unlink-youtube') {
        const userId = i.options.getUser('member',true).id, creator = store.one('SELECT * FROM creators WHERE user_id=?',userId);
        if (!creator) { store.set(`youtubeDisabled:${userId}`,true); return reply('Automatic channel linking disabled for this member. Staff can re-enable it with /link-youtube.'); }
        const member = await i.guild.members.fetch(userId); await member.roles.remove(c.youtubeRole);
        store.transaction(() => {
          store.set(`youtubeDisabled:${userId}`,true);
          store.run("UPDATE jobs SET state='cancelled' WHERE kind='creator' AND state IN ('queued','leased') AND json_extract(payload,'$.uuid')=?",creator.uuid);
          store.queue(`unlink:${userId}:${Date.now()}`,'unlink',{uuid:creator.uuid});
          store.run('DELETE FROM creators WHERE user_id=?',userId);
          store.run('DELETE FROM videos WHERE channel_id=?',creator.channel_id);
        });
        return reply('Channel unlinked; role removed and scoreboard removal queued.');
      }
    } catch (e) {
      const text = e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That account or channel is already linked. Contact staff.' : e.message;
      try { await reply(String(text).slice(0,1900)); } catch { console.error('Could not answer Discord interaction.'); }
    } finally { userLocks.delete(i.user.id); }
  });
  async function safely(label, work) {
    try { return await work(); }
    catch (error) {
      const message = `Discord maintenance (${label}): ${error.message || error}`;
      store.set('discordError', message);
      console.error(message);
      return undefined;
    }
  }
  async function processRows(label, rows, work) {
    for (const item of rows) await safely(`${label} ${item.id ? item.id.slice(0,8) : ''}`.trim(), () => work(item));
  }
  async function maintenance() {
    if (!client.isReady()) return;
    await safely('notification delivery', () => notifications.maintenance());
    await safely('draft cleanup', () => store.run('DELETE FROM drafts WHERE expires<?',Date.now()));
    await safely('verification cleanup', () => store.run('DELETE FROM verifications WHERE expires<?',Date.now()));
    for (const [id,time] of starts) if (Date.now()-time>60000) starts.delete(id);
    const guild = await safely('fetch server', () => client.guilds.fetch(c.guild));
    if (!guild) return;

    await safely('create application log messages', async () => {
      const apps = store.all('SELECT * FROM applications WHERE log_id IS NULL LIMIT 10');
      await processRows('create application log', apps, async app => {
        const a = JSON.parse(app.answers);
        const embed = new EmbedBuilder().setColor(0x65b891).setTitle(`Kind SMP application · ${app.id.slice(0,8)}`)
          .setDescription(`Applicant: <@${app.user_id}>\nEdition: ${app.edition}`)
          .addFields({name:'Minecraft username',value:app.username},{name:'Age',value:a.age},{name:'Agrees to rules',value:a.rules},{name:'How they heard about us',value:a.heard},{name:'Why they want to join',value:a.why},{name:'YouTube channel (optional)',value:a.youtube || 'Not provided'});
        if (a.previousAccount) embed.addFields({name:'Account change', value: a.previousAccount.edition + ': ' + a.previousAccount.username + ' → ' + app.edition + ': ' + app.username + '. Current membership stays active until whitelisting succeeds. Staff must remove the old whitelist entry if needed. Existing YouTube links are retained.'});
        const msg = await send(c.log,{embeds:[embed],components:[row(button(`approve:${app.id}`,'Approve',ButtonStyle.Success),button(`reject:${app.id}`,'Reject with reason',ButtonStyle.Danger))]},`application:${app.id}`);
        store.run('UPDATE applications SET log_id=? WHERE id=?',msg.id,app.id);
      });
    });

    await safely('application outcome messages', async () => {
      const apps = store.all("SELECT * FROM applications WHERE state<>'pending' AND notification_done=0 AND log_id IS NOT NULL LIMIT 20");
      await processRows('application outcome', apps, async app => {
        try {
          const ch = await client.channels.fetch(c.log);
          const msg = await ch.messages.fetch(app.log_id);
          const embeds = msg.embeds.map(e => EmbedBuilder.from(e).setFields(e.fields.map(f => f.name.startsWith('YouTube') ? {...f,name:'YouTube channel (optional)'} : f)));
          await msg.edit({embeds,components:[],content:applicationOutcome(app),allowedMentions:{parse:[]}});
        } catch (error) {
          if (!uneditableMessageCodes.has(String(error.code))) throw error;
          if (String(error.code) === '50005' || String(error.code) === '10008') {
            try {
              const replacement = await send(c.log,applicationStatusBody(app),`application-status:${app.id}:${app.state}`);
              store.run('UPDATE applications SET log_id=? WHERE id=?',replacement.id,app.id);
            } catch (postError) {
              store.set('discordError',`Application outcome ${app.id.slice(0,8)} could not be posted (Discord ${postError.code || 'error'}).`);
              console.error(`Could not post replacement application status ${app.id.slice(0,8)}:`, postError.message || postError);
            }
          }
        }
        store.run('UPDATE applications SET notification_done=1 WHERE id=? AND state=?',app.id,app.state);
      });
    });

    await safely('member role retries', async () => {
      const apps = store.all("SELECT * FROM applications WHERE state IN ('approved','ready') AND role_done=0 LIMIT 20");
      await processRows('member role', apps, async app => {
        try {
          const member = await guild.members.fetch(app.user_id);
          await member.roles.add(c.memberRole,'Kind SMP application approved (retry)');
          store.run('UPDATE applications SET role_done=1 WHERE id=?',app.id);
          store.set(`memberRoleFailureNotice:${app.id}`,null);
        } catch (error) { await reportMemberRoleFailure(app,error,'retrying role assignment'); }
      });
    });

    await safely('YouTuber role retries', async () => {
      const creators = store.all('SELECT * FROM creators WHERE role_done=0 LIMIT 20');
      await processRows('YouTuber role', creators, async creator => {
        try { const member = await guild.members.fetch(creator.user_id); await member.roles.add(c.youtubeRole,'YouTube channel linked through staff-approved application'); store.run('UPDATE creators SET role_done=1 WHERE user_id=?',creator.user_id); }
        catch (error) { store.set('discordError',`YouTuber role assignment failed (Discord ${error.code || 'error'}).`); console.error('YouTuber role assignment failed:',error.message || error); }
      });
    });

    await safely('create bounty review messages', async () => {
      const bounties=store.all("SELECT * FROM bounties WHERE state='pending' AND review_message_id IS NULL LIMIT 10");
      await processRows('create bounty review',bounties,async bounty=>{
        const msg=await send(c.bountyStaffChannel,{...bountyContent(bounty,c),components:[row(
          button(`bounty-approve:${bounty.id}`,'Approve',ButtonStyle.Success),
          button(`bounty-reject:${bounty.id}`,'Reject with reason',ButtonStyle.Danger))]},`bounty-review:${bounty.id}`);
        store.run('UPDATE bounties SET review_message_id=?,discord_dirty=0 WHERE id=? AND review_message_id IS NULL',msg.id,bounty.id);
      });
    });

    await safely('bounty Discord updates', async () => {
      const bounties=store.all('SELECT * FROM bounties WHERE discord_dirty=1 LIMIT 20');
      await processRows('bounty Discord update',bounties,async bounty=>{
        const result=JSON.parse(bounty.result || '{}');
        if (bounty.state === 'approved') {
          if (bounty.review_message_id) {
            const review=await client.channels.fetch(c.bountyStaffChannel), reviewMsg=await review.messages.fetch(bounty.review_message_id);
            await reviewMsg.edit({...bountyContent(bounty,c,'approved'),components:[],content:'Approved by staff; waiting for Minecraft server confirmation.'});
          }
          store.run('UPDATE bounties SET discord_dirty=0 WHERE id=?',bounty.id);
        } else if (bounty.state === 'active') {
          if (bounty.review_message_id) {
            try {
              const review=await client.channels.fetch(c.bountyStaffChannel), reviewMsg=await review.messages.fetch(bounty.review_message_id);
              const reviewText=JSON.parse(bounty.payload || '{}').ownerEvent ? 'Owner event bounty published directly.' : 'Approved and confirmed by the Minecraft server.';
              await reviewMsg.edit({...bountyContent(bounty,c,'active'),components:[],content:reviewText});
            } catch (error) { console.error(`Could not update bounty review ${bounty.id.slice(0,8)}: ${error.message || error}`); }
          }
          if (!bounty.public_message_id) {
            const msg=await send(c.bountyChannel,{...bountyContent(bounty,c,'active'),content:'@everyone A new SMP bounty is live!'},`bounty-public:${bounty.id}`,{mentionEveryone:true});
            store.run('UPDATE bounties SET public_message_id=?,discord_dirty=0 WHERE id=?',msg.id,bounty.id);
          } else {
            const channel=await client.channels.fetch(c.bountyChannel), msg=await channel.messages.fetch(bounty.public_message_id);
            await msg.edit({...bountyContent(bounty,c,'active'),components:[]});
            store.run('UPDATE bounties SET discord_dirty=0 WHERE id=?',bounty.id);
          }
        } else if (['claimed','expired','refunded','rejected','cancelled'].includes(bounty.state)) {
          const content=bounty.state==='rejected' && result.reason ? `Reason: ${result.reason}` : bounty.state==='cancelled' ? 'Withdrawn by the poster; escrow has been returned.' : '';
          const destinations = bounty.state==='cancelled'
            ? [[c.bountyChannel,bounty.public_message_id],[c.bountyStaffChannel,bounty.review_message_id]]
            : [[['rejected'].includes(bounty.state) ? c.bountyStaffChannel : c.bountyChannel,
                ['rejected'].includes(bounty.state) ? bounty.review_message_id : bounty.public_message_id]];
          for (const [channelId,messageId] of destinations) {
            if (!messageId) continue;
            try {
              const channel=await client.channels.fetch(channelId), msg=await channel.messages.fetch(messageId);
              await msg.edit({...bountyContent(bounty,c,bounty.state,result),components:[],content,allowedMentions:{parse:[]}});
            } catch (error) {
              console.error(`Could not update withdrawn/settled bounty ${bounty.id.slice(0,8)} in channel ${channelId}: ${error.message || error}`);
            }
          }
          store.run('UPDATE bounties SET discord_dirty=0 WHERE id=?',bounty.id);
        }
      });
    });

    await safely('queued Discord posts', async () => {
      const posts = store.all('SELECT * FROM posts WHERE message_id IS NULL AND next_try<? LIMIT 20',Date.now());
      await processRows('queued post', posts, async p => {
        try { const msg = await send(p.channel,JSON.parse(p.body),p.key); store.run('UPDATE posts SET message_id=? WHERE key=?',msg.id,p.key); }
        catch { store.run('UPDATE posts SET attempts=attempts+1,next_try=? WHERE key=?',Date.now()+Math.min(3600000,30000*2**Math.min(p.attempts,7)),p.key); }
      });
    });
  }  return { client, maintenance };
}
