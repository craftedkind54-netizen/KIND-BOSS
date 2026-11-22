// Website applications (people without Discord).
// POST /web-apply -> embed with Approve / Reject in the application log.
// Approve queues the same whitelist job the plugin already runs and emails the applicant.
import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

const ALLOWED_ORIGINS = (process.env.WEB_APPLY_ORIGINS || 'https://kindsmp-apply.netlify.app').split(',').map(s => s.trim()).filter(Boolean);
const MODPACK_URL = process.env.WEB_APPLY_MODPACK_URL || 'https://kindsmp-apply.netlify.app/#modpack';
const DISCORD_INVITE = process.env.WEB_APPLY_DISCORD_INVITE || 'https://discord.gg/eS2NWZmuxF';
const hits = new Map();

const clean = (v, max) => String(v ?? '').replace(/@(everyone|here)/gi, '@​$1').trim().slice(0, max);
const emailOk = v => /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i.test(v);

function validate(b) {
  const a = {
    username: clean(b.username, 32), age: clean(b.age, 3), edition: clean(b.edition, 10).toLowerCase(),
    timezone: clean(b.timezone, 100), contact: clean(b.contact, 200), found: clean(b.found, 500),
    why: clean(b.why, 1000), plans: clean(b.plans, 1000), experience: clean(b.experience, 1000),
    bans: clean(b.bans, 500), extra: clean(b.extra, 1000)
  };
  if (!['java', 'bedrock'].includes(a.edition)) throw new Error('Choose Java or Bedrock.');
  const pattern = a.edition === 'java' ? /^[A-Za-z0-9_]{3,16}$/ : /^[A-Za-z0-9][A-Za-z0-9 _]{0,15}$/;
  if (!pattern.test(a.username)) throw new Error('Enter a valid Minecraft username.');
  if (!/^\d{1,3}$/.test(a.age) || Number(a.age) < 13) throw new Error('Applicants must be at least 13.');
  if (!a.why) throw new Error('Tell us why you want to join.');
  a.email = emailOk(a.contact) ? a.contact : '';
  if (!a.email) throw new Error('Enter an email address so we can tell you the result.');
  return a;
}

let mailer;
async function sendEmail(to, subject, text) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return 'not configured (set SMTP_USER and SMTP_PASS in Railway)';
  try {
    if (!mailer) {
      const nodemailer = (await import('nodemailer')).default;
      mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user, pass }
      });
    }
    await mailer.sendMail({ from: process.env.SMTP_FROM || `KindSMP <${user}>`, to, subject, text });
    return 'sent';
  } catch (e) { return 'failed: ' + String(e.message || e).slice(0, 150); }
}

function approvedText(app, c) {
  const lines = [`Hi ${app.username},`, '', 'Good news: your KindSMP application was approved! Your Minecraft account is being added to the whitelist now (it finishes as soon as the server is online).', ''];
  if (c.java) lines.push('Java address: ' + c.java);
  if (c.bedrock) lines.push('Bedrock address: ' + c.bedrock + '  Port: ' + c.bedrockPort);
  if (app.edition === 'java') lines.push('', 'Java players need our modpack: ' + MODPACK_URL);
  lines.push('', 'Join our Discord too (optional): ' + DISCORD_INVITE, '', 'See you on the server!', 'KindSMP staff');
  return lines.join('\n');
}
function rejectedText(app, reason) {
  return [`Hi ${app.username},`, '', 'Thanks for applying to KindSMP. Unfortunately your application was not approved this time.',
    reason ? '\nReason: ' + reason : '', '', 'You are welcome to apply again later.', 'KindSMP staff'].join('\n');
}

function embedFor(app, status) {
  const e = new EmbedBuilder().setTitle('New website application: ' + app.username).setColor(status ? (status.ok ? 0x2ecc71 : 0xe74c3c) : 0x5865f2)
    .addFields(
      { name: 'Minecraft username', value: app.username, inline: true }, { name: 'Age', value: app.age, inline: true },
      { name: 'Edition', value: app.edition === 'java' ? 'Java' : 'Bedrock', inline: true },
      ...[['Timezone', app.timezone], ['Contact', app.contact], ['Found us via', app.found], ['Why join', app.why], ['Plans', app.plans],
        ['Experience', app.experience], ['Bans', app.bans], ['Extra', app.extra]].filter(([, v]) => v).map(([name, value]) => ({ name, value: value.slice(0, 1024) }))
    ).setFooter({ text: 'Applied via website (no Discord)' }).setTimestamp(app.created);
  if (status) e.addFields({ name: 'Result', value: status.text.slice(0, 1024) });
  return e;
}
const buttons = id => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('webapprove:' + id).setLabel('Approve').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('webreject:' + id).setLabel('Reject').setStyle(ButtonStyle.Danger))];

export function attachWebApplications(http, client, store, c) {
  const base = http.listeners('request');
  http.removeAllListeners('request');
  http.on('request', async (req, res) => {
    const path = req.url.split('?')[0];
    if (path !== '/web-apply') return base.forEach(fn => fn.call(http, req, res));
    const origin = req.headers.origin || '';
    const cors = ALLOWED_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }); return res.end(); }
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    if (!cors['Access-Control-Allow-Origin']) return reply(403, { error: 'Forbidden origin' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
    if (recent.length >= 3) return reply(429, { error: 'Too many applications. Try again later.' });
    try {
      let size = 0; const chunks = [];
      for await (const ch of req) { size += ch.length; if (size > 20000) return reply(413, { error: 'Too large' }); chunks.push(ch); }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (body.website) return reply(200, { ok: true }); // honeypot
      const app = { ...validate(body), id: randomUUID(), created: now, state: 'pending' };
      recent.push(now); hits.set(ip, recent);
      const channel = await client.channels.fetch(c.log);
      const msg = await channel.send({ embeds: [embedFor(app)], components: buttons(app.id), allowedMentions: { parse: [] } });
      app.messageId = msg.id;
      store.set('webapp:' + app.id, app);
      return reply(200, { ok: true });
    } catch (e) { return reply(400, { error: e.message || 'Could not submit' }); }
  });

  async function isStaff(i) {
    const member = await i.guild.members.fetch({ user: i.user.id, force: true });
    return c.staffRoles.some(id => member.roles.cache.has(id));
  }
  async function finish(i, app, ok, reason) {
    app.state = ok ? 'approved' : 'rejected'; app.reviewer = i.user.id; app.decided = Date.now(); app.reason = reason || '';
    if (ok) store.queue('whitelist:web:' + app.id, 'whitelist', { applicationId: 'web:' + app.id, edition: app.edition, username: app.username, redo: true });
    store.set('webapp:' + app.id, app);
    const mail = await sendEmail(app.email, ok ? 'Your KindSMP application was approved!' : 'Your KindSMP application',
      ok ? approvedText(app, c) : rejectedText(app, reason));
    app.email_status = mail; store.set('webapp:' + app.id, app);
    const text = (ok ? `✅ Approved by <@${i.user.id}>. Whitelist sent to the server.` : `❌ Rejected by <@${i.user.id}>.` + (reason ? ' Reason: ' + reason : '')) + `\nEmail: ${mail}.`;
    const channel = await client.channels.fetch(c.log);
    const msg = await channel.messages.fetch(app.messageId);
    await msg.edit({ embeds: [embedFor(app, { ok, text })], components: [] });
    return text;
  }

  client.on('interactionCreate', async i => {
    const id = i.customId || '';
    if (!/^web(approve|reject|rejectmodal):/.test(id)) return;
    try {
      if (i.guildId !== c.guild) return;
      const appId = id.split(':')[1], app = store.get('webapp:' + appId, null);
      if (id.startsWith('webreject:')) {
        if (!(await isStaff(i))) return i.reply({ content: 'Only staff can do that.', flags: 64 });
        return i.showModal(new ModalBuilder().setCustomId('webrejectmodal:' + appId).setTitle('Reject application')
          .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason (emailed to them, optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500))));
      }
      await i.deferReply({ flags: 64 });
      if (!(await isStaff(i))) return i.editReply('Only staff can do that.');
      if (!app) return i.editReply('This website application was not found.');
      if (app.state !== 'pending') return i.editReply('Already ' + app.state + '.');
      const reason = id.startsWith('webrejectmodal:') ? clean(i.fields.getTextInputValue('reason'), 500) : '';
      return i.editReply(await finish(i, app, id.startsWith('webapprove:'), reason));
    } catch (e) {
      console.error('Website application button:', e);
      try { (i.deferred || i.replied) ? await i.editReply('Error: ' + e.message) : await i.reply({ content: 'Error: ' + e.message, flags: 64 }); } catch {}
    }
  });
}
