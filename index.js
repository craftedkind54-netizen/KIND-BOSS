require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is required');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
});
global.__KIND_BOSS_CLIENT = client;
require('./src/tickets');
require('./src/announcements');
require('./src/strikes');
client.login(process.env.DISCORD_TOKEN);
