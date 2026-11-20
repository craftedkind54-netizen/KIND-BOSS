require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is required');

// The strike API stays private on loopback; Kind Bridge is the only public
// listener and forwards /api/v1 to it. Railway exposes one service and one URL.
process.env.STRIKES_API_PORT ||= '3001';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
  allowedMentions: { parse: [] }
});

global.__KIND_BOSS_CLIENT = client;
require('./src/tickets');
require('./src/announcements');
require('./src/strikes');
require('./src/venting');
require('./src/staffApplications');
require('./src/intros');

let stopBridge;
async function shutdown() {
  try { await stopBridge?.(); } catch (e) { console.error('Kind Bridge shutdown:', e.message); }
  await client.destroy();
  process.exit(0);
}

(async () => {
  const { startKindBridge } = await import('./kindbridge/bot/src/main.js');
  stopBridge = await startKindBridge(client);
  console.log('[Startup] Kind Bridge ready, logging in to Discord...');

  // Diagnostics: a login that never reaches Ready leaves every button
  // showing "The application didn't respond in time".
  try {
    const res = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    const body = await res.json().catch(() => ({}));
    console.log(`[Startup] Discord gateway check: HTTP ${res.status}`, JSON.stringify(body.session_start_limit || body));
  } catch (e) {
    console.error('[Startup] Discord gateway check failed:', e.message);
  }
  client.on('error', e => console.error('[Discord] client error:', e));
  client.on('shardError', e => console.error('[Discord] shard error:', e));
  client.on('shardDisconnect', (ev, id) => console.warn(`[Discord] shard ${id} disconnected: ${ev?.code} ${ev?.reason || ''}`));
  client.on('debug', m => {
    if (/identify|session|rate|limit|429|heartbeat ack|ready|close|invalid|error/i.test(m) && !/heartbeat ack/i.test(m)) console.log('[Discord debug]', m);
  });
  client.once('clientReady', () => console.log(`[Startup] Discord ready as ${client.user.tag}`));
  setTimeout(() => {
    if (!client.isReady()) console.error('[Startup] Still not connected to Discord after 60s.');
  }, 60000).unref();

  await client.login(process.env.DISCORD_TOKEN);
  console.log('[Startup] client.login() resolved');
})().catch(error => {
  console.error('KIND BOSS startup failed:', error);
  process.exitCode = 1;
});

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
