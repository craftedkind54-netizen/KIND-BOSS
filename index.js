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
  await client.login(process.env.DISCORD_TOKEN);
})().catch(error => {
  console.error('KIND BOSS startup failed:', error);
  process.exitCode = 1;
});

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
