import { randomUUID } from 'node:crypto';
export function validateApplication(a) {
  if (!['java', 'bedrock'].includes(a.edition)) throw new Error('Choose Java or Bedrock.');
  a.username = String(a.username || '').trim();
  const pattern = a.edition === 'java' ? /^[A-Za-z0-9_]{3,16}$/ : /^[A-Za-z0-9][A-Za-z0-9 _]{0,15}$/;
  if (!pattern.test(a.username)) throw new Error(a.edition === 'java' ? 'Enter a Java username (3–16 letters, numbers or underscores).' : 'Enter your exact Xbox gamertag, including spaces, without the Floodgate prefix.');
  if (!/^\d{1,3}$/.test(String(a.age)) || Number(a.age) < 13 || Number(a.age) > 120) throw new Error('Applicants must be at least 13. Enter a valid age in years.');
  if (!['yes', 'i agree', 'agree'].includes(String(a.rules).trim().toLowerCase())) throw new Error('You must agree to the SMP rules by entering Yes.');
  if (!a.why?.trim() || a.why.length > 1000) throw new Error('Please tell us why you want to join (up to 1,000 characters).');
  if (a.heard && a.heard.length > 1000) throw new Error('Keep how you heard about us under 1,000 characters.');
  if (a.youtube && !/^https:\/\/(www\.)?youtube\.com\/(channel\/UC[\w-]{22}|@[\w.%-]+)\/?$/i.test(a.youtube)) throw new Error('Use a YouTube channel URL such as https://www.youtube.com/@YourHandle, or leave it blank.');
  return a;
}
export function submit(store, userId, input, cooldown, now = Date.now(), { reapplyApproved = false } = {}) {
  const a = validateApplication(input);
  return store.transaction(() => {
    // Let an applicant correct a Minecraft name after a permanent lookup failure.
    if (!reapplyApproved) store.run("UPDATE applications SET state='superseded',notification_done=0 WHERE user_id=? AND state='approved' AND EXISTS (SELECT 1 FROM jobs WHERE kind='whitelist' AND state='failed' AND json_extract(payload,'$.applicationId')=applications.id AND (instr(lower(coalesce(error,'')),'account not found')>0 OR instr(lower(coalesce(error,'')),'gamertag not found')>0))", userId);
    if (reapplyApproved) {
      const approved = store.one("SELECT id FROM applications WHERE user_id=? AND state='approved' ORDER BY created DESC,rowid DESC LIMIT 1", userId);
      if (!approved) throw new Error('There is no approved whitelist request to replace. Use /apply to start an application.');
      store.run("UPDATE applications SET state='superseded',notification_done=0 WHERE id=? AND state='approved'", approved.id);
      store.run("UPDATE jobs SET state='cancelled',lease=NULL WHERE kind='whitelist' AND state IN ('queued','leased') AND json_extract(payload,'$.applicationId')=?", approved.id);
    }
    if (store.one("SELECT id FROM applications WHERE user_id=? AND state IN ('pending','approved')", userId)) throw new Error('You already have an application awaiting review or whitelisting. Use /status.');
    // Rejected applicants may submit a corrected application immediately; active reviews stay protected above.
    if (store.one("SELECT id FROM applications WHERE edition=? AND username=? COLLATE NOCASE AND state IN ('pending','approved','ready')", a.edition, a.username)) throw new Error('That Minecraft account already has an active application. Ask staff if this is a mistake.');
    const previous = store.one("SELECT edition,username FROM applications WHERE user_id=? AND state='ready'", userId);
    if (previous) a.previousAccount = { edition: previous.edition, username: previous.username };
    else delete a.previousAccount;
    const id = randomUUID();
    store.run('INSERT INTO applications(id,user_id,edition,username,answers,created) VALUES (?,?,?,?,?,?)', id, userId, a.edition, a.username, JSON.stringify(a), now);
    return id;
  });
}
export function decide(store, id, reviewer, approve, reason = '', now = Date.now()) {
  if (!approve && !reason.trim()) throw new Error('A rejection reason is required.');
  return store.transaction(() => {
    const r = store.one("SELECT * FROM applications WHERE id=? AND state='pending'", id);
    if (!r) throw new Error('This application was already reviewed or does not exist.');
    store.run('UPDATE applications SET state=?,reviewer=?,reason=?,decided=? WHERE id=?', approve ? 'approved' : 'rejected', reviewer, reason.trim().slice(0, 1000), now, id);
    if (approve) store.queue(`whitelist:${id}`, 'whitelist', { applicationId: id, edition: r.edition, username: r.username });
  });
}
export function joining(c, whitelisted = true) {
  const lines = [whitelisted
    ? 'Welcome to Kind SMP! Your application is approved and your Minecraft account is whitelisted.'
    : 'Welcome to Kind SMP! Your application is approved. Minecraft whitelisting is still pending; we will DM you again when your account is whitelisted.'];
  if (c.java) lines.push('Java: ' + c.java);
  if (c.bedrock) lines.push('Bedrock: ' + c.bedrock + ' • Port: ' + c.bedrockPort);
  if (!c.java && !c.bedrock) lines.push('The server address has not been added yet. Please ask staff for the address.');
  lines.push('Rules: <#' + c.rules + '>');
  return lines.join('\n');
}
// Checks a Java name with Mojang before the form is accepted. Returns 'found', 'missing' or 'unknown'.
// Bedrock gamertags cannot be checked in advance: GeyserMC only knows players who joined a Geyser server before.
export async function lookupMinecraftAccount(edition, name, fetchImpl = fetch) {
  if (edition !== 'java') return 'unknown';
  try {
    const res = await fetchImpl('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name), { signal: AbortSignal.timeout(2000) });
    if (res.status === 200) return 'found';
    if (res.status === 204 || res.status === 404) return 'missing';
  } catch { /* Network trouble never blocks an application. */ }
  return 'unknown';
}
// Approved applications whose whitelist job failed go back to staff review with the reason.
export function returnFailedWhitelistsToReview(store) {
  return store.transaction(() => {
    const rows = store.all("SELECT a.id, j.error FROM applications a JOIN jobs j ON j.kind='whitelist' AND j.state='failed' AND json_extract(j.payload,'$.applicationId')=a.id WHERE a.state='approved' AND NOT EXISTS (SELECT 1 FROM jobs k WHERE k.kind='whitelist' AND k.state IN ('queued','leased','done') AND json_extract(k.payload,'$.applicationId')=a.id)");
    for (const r of rows) {
      store.set('whitelistFailure:' + r.id, String(r.error || 'Unknown error').slice(0, 300));
      store.run("DELETE FROM jobs WHERE kind='whitelist' AND state='failed' AND json_extract(payload,'$.applicationId')=?", r.id);
      store.run("UPDATE applications SET state='pending',reviewer=NULL,decided=NULL,log_id=NULL,notification_done=0 WHERE id=? AND state='approved'", r.id);
    }
    return rows.length;
  });
}
// Staff lookup: what the bot knows about a Minecraft name or Discord member's whitelist.
// Only covers whitelisting done through applications; console whitelists are not visible here.
export function whitelistReport(store, query) {
  const q = String(query || '').trim().replace(/^<@!?(\d+)>$/, '$1').replace(/^[.*]/, '');
  if (!q) throw new Error('Type a Minecraft username or Discord user ID.');
  const apps = store.all('SELECT * FROM applications WHERE username=? COLLATE NOCASE OR user_id=? ORDER BY created DESC,rowid DESC LIMIT 5', q, q);
  if (!apps.length) return `No application found for **${q}**. If they were added with a console command, check in game with \`whitelist list\` (Bedrock: \`fwhitelist\`).`;
  return apps.map(app => {
    const job = store.one("SELECT state,error FROM jobs WHERE kind='whitelist' AND json_extract(payload,'$.applicationId')=? ORDER BY rowid DESC LIMIT 1", app.id);
    const status = {
      ready: '✅ Whitelisted — the server confirmed it.',
      approved: job?.state === 'failed' ? '❌ Whitelist failed: ' + (job.error || 'unknown error') + ' (sent back to staff review).' : '⏳ Approved — waiting for the Minecraft server to whitelist them (it runs when the server is online).',
      pending: store.get('whitelistFailure:' + app.id) ? '🔁 Back in staff review after a failed whitelist: ' + store.get('whitelistFailure:' + app.id) : '📝 Waiting for staff review — not whitelisted yet.',
      rejected: '🚫 Rejected: ' + (app.reason || 'no reason'),
      superseded: '↪️ Replaced by a newer application.',
      cancelled: '👋 Left the Discord — removed from the whitelist.'
    }[app.state] || app.state;
    return `**${app.username}** (${app.edition}) · Discord: <@${app.user_id}> · applied <t:${Math.floor(app.created / 1000)}:R>\n${status}`;
  }).join('\n\n');
}
