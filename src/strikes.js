require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('node:path');
const { createApplicationDiscordLookup } = require('./playerDiscordLinks');
const { punishmentFor, projectedTotal } = require('./strikePolicy');
const { reversibleStrikeAmount } = require('./strikeAppealPolicy');
const { createStaffCommandEmbed } = require('./staffAudit');
const { createActivePlayerGoal } = require('./activePlayerGoal');
const {
  Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
  StringSelectMenuBuilder, ChannelType, PermissionFlagsBits
} = require('discord.js');

// This is a standalone strike module/bot entry point. If your existing index.js already
// creates a Discord Client, merge the marked STRIKE SYSTEM sections into that file and
// reuse its existing client instead of creating a second login with the same token.

const TOKEN = process.env.DISCORD_TOKEN;
const API_SECRET = process.env.BRIDGE_SECRET || process.env.STRIKES_API_SECRET;
// Kind Bridge owns the public Railway port in the combined service. Keep the
// strike API on loopback and proxy /api/v1 through the shared public listener.
const PORT = Number(process.env.STRIKES_API_PORT || 3001);
const DB_PATH = process.env.STRIKES_DB_PATH || './data/strikes.db';
const STRIKES_DATA_DIR = path.dirname(path.resolve(DB_PATH));
const PERSISTENT_DATA_DIR = process.env.PERSISTENT_DATA_DIR || process.env.DATA_DIR;
const KIND_BRIDGE_DB_PATH = process.env.KIND_BRIDGE_DB_PATH || path.join(PERSISTENT_DATA_DIR || STRIKES_DATA_DIR, 'kind-smp.db');
const KIND_BRIDGE_DB_PATHS = [
  path.join(STRIKES_DATA_DIR, 'kind-smp.db'),
  PERSISTENT_DATA_DIR && path.join(PERSISTENT_DATA_DIR, 'kind-smp.db'),
  '/app/data/kind-smp.db',
  '/data/kind-smp.db'
].filter(Boolean);
const GUILD_ID = process.env.GUILD_ID || '1555704317552361563';
const STRIKE_LOG_CHANNEL_ID = process.env.STRIKE_LOG_CHANNEL_ID || '1555840868693442640';
const STRIKE_MANAGEMENT_CHANNEL_ID = process.env.STRIKE_MANAGEMENT_CHANNEL_ID || '1555840868693442640';
let strikeApprovalChannelId = process.env.STRIKE_APPROVAL_CHANNEL_ID || '';
const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID || '1555827222688829441';
const MINECRAFT_FEED_CHANNEL_ID = process.env.MINECRAFT_FEED_CHANNEL_ID || '1555986926052315208';
const STAFF_AUDIT_CHANNEL_ID = process.env.STAFF_AUDIT_CHANNEL_ID || '1561291135819714630';
const ACTIVE_GOAL_PROGRESS_CHANNEL_ID = process.env.ACTIVE_GOAL_PROGRESS_CHANNEL_ID || '1561320960135659520';
const ACTIVE_GOAL_MANAGEMENT_CHANNEL_ID = process.env.ACTIVE_GOAL_MANAGEMENT_CHANNEL_ID || '1561323169862783086';
const STAFF_ROLE_IDS = [process.env.OWNER_ROLE_ID || '1555827222688829441', process.env.SENIOR_STAFF_ROLE_ID || '1555839917815238736', process.env.GENERAL_STAFF_ROLE_ID || '1555840026607362099'];
const BEDROCK_PREFIX = '.';


if (!API_SECRET || API_SECRET.length < 32) throw new Error('STRIKES_API_SECRET must be at least 32 characters');

const fs = require('fs'); fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS players (uuid TEXT PRIMARY KEY, username TEXT NOT NULL, normalized_username TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name ON players(normalized_username);
CREATE TABLE IF NOT EXISTS strike_totals (player_uuid TEXT PRIMARY KEY REFERENCES players(uuid) ON DELETE CASCADE, total INTEGER NOT NULL DEFAULT 0 CHECK(total >= 0));
CREATE TABLE IF NOT EXISTS strike_actions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL UNIQUE, player_uuid TEXT NOT NULL, username_at_time TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('add','remove')), requested_amount INTEGER NOT NULL, applied_amount INTEGER NOT NULL,
 previous_total INTEGER NOT NULL, new_total INTEGER NOT NULL, reason TEXT NOT NULL, source TEXT NOT NULL,
 staff_identity TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_requests (action_id TEXT PRIMARY KEY, response_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discord_active_messages (player_uuid TEXT PRIMARY KEY, message_id TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending_strike_proposals (
 proposal_id TEXT PRIMARY KEY, player_uuid TEXT NOT NULL, username TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('add','remove')), amount INTEGER NOT NULL,
 reason TEXT NOT NULL, source TEXT NOT NULL, staff_identity TEXT NOT NULL,
 created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', message_id TEXT,
 decided_at TEXT, decided_by TEXT, result_json TEXT
);
CREATE TABLE IF NOT EXISTS strike_appeals (
 appeal_id TEXT PRIMARY KEY, player_uuid TEXT NOT NULL, username TEXT NOT NULL,
 strike_action_id INTEGER NOT NULL, discord_user_id TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')),
 message_id TEXT, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, result_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_strike_appeals_player
 ON strike_appeals(player_uuid) WHERE status='pending';
CREATE TABLE IF NOT EXISTS minecraft_punishment_reversals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, appeal_id TEXT NOT NULL UNIQUE,
 player_uuid TEXT NOT NULL, username TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', last_error TEXT, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS minecraft_staff_rank_actions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, app_id INTEGER NOT NULL UNIQUE,
 discord_user_id TEXT NOT NULL, minecraft_uuid TEXT NOT NULL, minecraft_username TEXT NOT NULL,
 target_rank TEXT NOT NULL, minecraft_rank TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 last_error TEXT, created_at TEXT NOT NULL, completed_at TEXT
);
`);
if (!strikeApprovalChannelId) strikeApprovalChannelId = db.prepare(`SELECT value FROM app_state WHERE key='strike_approval_channel_id'`).get()?.value || '';
const activePlayerGoal = createActivePlayerGoal(db, { timezone: process.env.ACTIVE_GOAL_TIMEZONE || 'Pacific/Honolulu' });

const normalizeName = n => n.trim().toLowerCase();
const validAmount = n => Number.isSafeInteger(n) && n > 0 && n <= 1000000;
const client = global.__KIND_BOSS_CLIENT;
const discordUserIdForPlayer = createApplicationDiscordLookup({ databasePath: KIND_BRIDGE_DB_PATH, databasePaths: KIND_BRIDGE_DB_PATHS, DatabaseClass: Database });

const upsertPlayer = db.prepare(`INSERT INTO players(uuid,username,normalized_username,updated_at) VALUES(?,?,?,?) ON CONFLICT(uuid) DO UPDATE SET username=excluded.username, normalized_username=excluded.normalized_username, updated_at=excluded.updated_at`);
const ensureTotal = db.prepare(`INSERT OR IGNORE INTO strike_totals(player_uuid,total) VALUES(?,0)`);
const getPlayerByName = db.prepare(`SELECT p.uuid,p.username,COALESCE(s.total,0) total FROM players p LEFT JOIN strike_totals s ON s.player_uuid=p.uuid WHERE p.normalized_username=?`);
const getTotal = db.prepare(`SELECT total FROM strike_totals WHERE player_uuid=?`);
const getProcessed = db.prepare(`SELECT response_json FROM processed_requests WHERE action_id=?`);
const setProcessed = db.prepare(`INSERT INTO processed_requests(action_id,response_json,created_at) VALUES(?,?,?)`);
const insertAction = db.prepare(`INSERT INTO strike_actions(action_id,player_uuid,username_at_time,action,requested_amount,applied_amount,previous_total,new_total,reason,source,staff_identity,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
const updateTotal = db.prepare(`UPDATE strike_totals SET total=? WHERE player_uuid=?`);

const applyActionTx = db.transaction(input => {
  const cached = getProcessed.get(input.actionId); if (cached) return JSON.parse(cached.response_json);
  if (!['add','remove'].includes(input.action)) throw new Error('Invalid action');
  if (!validAmount(input.amount)) throw new Error('Amount must be a whole number from 1 to 1000000');
  if (!input.reason || !input.reason.trim()) throw new Error('Reason is required');
  if (!input.playerUuid || !input.username) throw new Error('Player UUID and username are required');
  const now = new Date().toISOString(); upsertPlayer.run(input.playerUuid,input.username,normalizeName(input.username),now); ensureTotal.run(input.playerUuid);
  const previous = getTotal.get(input.playerUuid).total;
  const applied = input.action === 'add' ? input.amount : Math.min(previous,input.amount);
  const next = input.action === 'add' ? previous + applied : previous - applied;
  if (!Number.isSafeInteger(next) || next < 0) throw new Error('Strike total overflow');
  updateTotal.run(next,input.playerUuid);
  insertAction.run(input.actionId,input.playerUuid,input.username,input.action,input.amount,applied,previous,next,input.reason.trim(),input.source,input.staffIdentity||'Unknown',now);
  const result={ok:true,username:input.username,discordUserId:discordUserIdForPlayer(input.playerUuid),requestedAmount:input.amount,appliedAmount:applied,previousTotal:previous,newTotal:next};
  setProcessed.run(input.actionId,JSON.stringify(result),now); return result;
});

function createProposal(input) {
 if (!['add','remove'].includes(input.action)) throw new Error('Invalid action');
 if (!validAmount(input.amount)) throw new Error('Amount must be a whole number from 1 to 1000000');
 if (!input.reason || !input.reason.trim()) throw new Error('Reason is required');
 if (!input.playerUuid || !input.username) throw new Error('Player UUID and username are required');
 if (!strikeApprovalChannelId) throw new Error('The owner-only strike approval channel has not been created yet. Check the bot permissions and Railway logs.');
 const proposalId = crypto.randomUUID();
 db.prepare(`INSERT INTO pending_strike_proposals(proposal_id,player_uuid,username,action,amount,reason,source,staff_identity,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
  .run(proposalId,input.playerUuid,input.username,input.action,input.amount,input.reason.trim(),input.source,input.staffIdentity||'Unknown',new Date().toISOString());
 return proposalId;
}
function proposalEmbed(p) {
 const current = getTotal.get(p.player_uuid)?.total || 0;
 const projected = projectedTotal(current,p.action,p.amount);
 const punishment = p.action === 'add' ? punishmentFor(projected) : null;
 const discordUserId = discordUserIdForPlayer(p.player_uuid);
 return new EmbedBuilder().setColor(0x8b5cf6).setTitle(`Strike ${p.action} request · ${p.username}`)
  .setDescription(`**Minecraft username:** ${p.username}\n**Discord account:** ${discordUserId ? `<@${discordUserId}>` : 'No approved application link found'}\n**Requested by:** ${p.staff_identity}\n**Source:** ${p.source}\n**Reason:** ${p.reason}`)
  .addFields({name:'Current total',value:String(current),inline:true},{name:'Requested change',value:`${p.action==='add'?'+':'−'}${p.amount}`,inline:true},{name:'Projected total',value:String(projected),inline:true},
   ...(punishment?[{name:'If approved',value:`${punishment.type==='jail'?'Jail':'Temporary ban'} · ${punishment.duration}`,inline:true}]:[]))
  .setFooter({text:`Proposal ${p.proposal_id}`}).setTimestamp(new Date(p.created_at));
}
const proposalRows = id => [new ActionRowBuilder().addComponents(
 new ButtonBuilder().setCustomId(`strike:approve-proposal:${id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
 new ButtonBuilder().setCustomId(`strike:deny-proposal:${id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
)];
async function publishProposal(id) {
 const p=db.prepare(`SELECT * FROM pending_strike_proposals WHERE proposal_id=? AND status='pending'`).get(id);
 if(!p || !strikeApprovalChannelId)return;
 const channel=await client.channels.fetch(strikeApprovalChannelId);
 if(!channel?.isTextBased())throw new Error('Strike approval channel is unavailable');
 if(p.message_id){
  const existing=await channel.messages.fetch(p.message_id).catch(()=>null);
  if(existing){await existing.edit({embeds:[proposalEmbed(p)],components:proposalRows(id),allowedMentions:{parse:[]}});return;}
 }
 const message=await channel.send({embeds:[proposalEmbed(p)],components:proposalRows(id),allowedMentions:{parse:[]}});
 db.prepare('UPDATE pending_strike_proposals SET message_id=? WHERE proposal_id=? AND status=\'pending\'').run(message.id,id);
}
function approveProposal(id, owner) {
 return db.transaction(() => {
  const p=db.prepare(`SELECT * FROM pending_strike_proposals WHERE proposal_id=?`).get(id);
  if(!p)throw new Error('Strike proposal not found');
  if(p.status!=='pending')throw new Error(`This proposal was already ${p.status}`);
  const result=applyActionTx({actionId:p.proposal_id,playerUuid:p.player_uuid,username:p.username,action:p.action,amount:p.amount,reason:p.reason,source:p.source,staffIdentity:p.staff_identity});
  const punishment=p.action==='add'?punishmentFor(result.newTotal):null;
  const enriched={...result,punishment};
  db.prepare(`UPDATE pending_strike_proposals SET status='approved',decided_at=?,decided_by=?,result_json=? WHERE proposal_id=? AND status='pending'`)
   .run(new Date().toISOString(),owner,JSON.stringify(enriched),id);
  return {proposal:p,result:enriched};
 })();
}
function denyProposal(id, owner) {
 const result=db.prepare(`UPDATE pending_strike_proposals SET status='denied',decided_at=?,decided_by=? WHERE proposal_id=? AND status='pending'`).run(new Date().toISOString(),owner,id);
 if(!result.changes)throw new Error('Strike proposal was not found or was already decided');
 return db.prepare(`SELECT * FROM pending_strike_proposals WHERE proposal_id=?`).get(id);
}

function latestFor(uuid){return db.prepare(`SELECT * FROM strike_actions WHERE player_uuid=? ORDER BY id DESC LIMIT 1`).get(uuid);}
function withDiscordLink(player){return {...player,discordUserId:discordUserIdForPlayer(player.uuid)};}
function activePlayers(){return db.prepare(`SELECT p.uuid,p.username,s.total FROM strike_totals s JOIN players p ON p.uuid=s.player_uuid WHERE s.total>0 ORDER BY s.total DESC,p.username COLLATE NOCASE`).all().map(withDiscordLink);}
function latestAppealableStrike(uuid){return db.prepare(`SELECT a.* FROM strike_actions a WHERE a.player_uuid=? AND a.action='add' AND a.applied_amount>0
 AND NOT EXISTS(SELECT 1 FROM strike_appeals ap WHERE ap.strike_action_id=a.id AND ap.status='approved') ORDER BY a.id DESC LIMIT 1`).get(uuid);}
function activeEmbed(p){
 const a=latestFor(p.uuid); const discordUserId=discordUserIdForPlayer(p.uuid); const e=new EmbedBuilder().setTitle(`⚠️ ${p.username}`).setDescription(`**Minecraft username:** ${p.username}\n**Discord account:** ${discordUserId ? `<@${discordUserId}>` : 'No approved application link found'}\n**Current strikes:** ${p.total}`).setTimestamp(a?new Date(a.created_at):new Date());
 if(a)e.addFields({name:'Most recent change',value:`${a.action==='add'?'+':'-'}${a.applied_amount}`,inline:true},{name:'Reason',value:a.reason.slice(0,1024),inline:false},{name:'Staff',value:(a.staff_identity||'Unknown').slice(0,1024),inline:true},{name:'Source',value:a.source,inline:true}); return e;
}
function activeRows(uuid){
 const pending=db.prepare(`SELECT 1 FROM strike_appeals WHERE player_uuid=? AND status='pending'`).get(uuid);
 const available=latestAppealableStrike(uuid);
 return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`strike:appeal:${uuid}`).setLabel(pending?'Appeal Pending':available?'Appeal This Strike':'No Strike to Appeal').setStyle(ButtonStyle.Primary).setDisabled(Boolean(pending)||!available))];
}
function appealEmbed(appeal){
 const discordUserId=appeal.discord_user_id;
 const action=db.prepare(`SELECT action,applied_amount,reason,staff_identity,created_at FROM strike_actions WHERE id=?`).get(appeal.strike_action_id);
 return new EmbedBuilder().setColor(0xf59e0b).setTitle(`Strike appeal · ${appeal.username}`)
  .setDescription(`**Minecraft username:** ${appeal.username}\n**Discord account:** <@${discordUserId}>\n**Appeal submitted by:** <@${discordUserId}>\n**Appeal reason:** ${appeal.reason}`)
  .addFields({name:'Strike being appealed',value:`+${action?.applied_amount||0} · ${action?.reason||'Strike record unavailable'}`,inline:false},
   {name:'Original staff member',value:(action?.staff_identity||'Unknown').slice(0,1024),inline:true})
  .setFooter({text:`Appeal ${appeal.appeal_id}`}).setTimestamp(new Date(appeal.created_at));
}
const appealRows=id=>[new ActionRowBuilder().addComponents(
 new ButtonBuilder().setCustomId(`strike:approve-appeal:${id}`).setLabel('Approve Appeal · Reverse').setStyle(ButtonStyle.Success),
 new ButtonBuilder().setCustomId(`strike:deny-appeal:${id}`).setLabel('Deny Appeal').setStyle(ButtonStyle.Danger)
)];
async function publishAppeal(id){
 const appeal=db.prepare(`SELECT * FROM strike_appeals WHERE appeal_id=? AND status='pending'`).get(id);
 if(!appeal||!strikeApprovalChannelId)return;
 const channel=await client.channels.fetch(strikeApprovalChannelId);
 if(!channel?.isTextBased())throw new Error('Strike appeal review channel is unavailable');
 if(appeal.message_id){const existing=await channel.messages.fetch(appeal.message_id).catch(()=>null);if(existing){await existing.edit({embeds:[appealEmbed(appeal)],components:appealRows(id),allowedMentions:{parse:[]}});return;}}
 const message=await channel.send({embeds:[appealEmbed(appeal)],components:appealRows(id),allowedMentions:{parse:[]}});
 db.prepare(`UPDATE strike_appeals SET message_id=? WHERE appeal_id=? AND status='pending'`).run(message.id,id);
}
function createAppeal(uuid,discordUserId,reason){
 const player=getPlayerByUuid.get(uuid);if(!player||player.total<=0)throw new Error('No active strike is available to appeal.');
 const latestAdd=latestAppealableStrike(uuid);
 if(!latestAdd)throw new Error('There is no unreviewed strike available to appeal.');
 const now=new Date().toISOString(),id=crypto.randomUUID();
 db.prepare(`INSERT INTO strike_appeals(appeal_id,player_uuid,username,strike_action_id,discord_user_id,reason,created_at)
   VALUES(?,?,?,?,?,?,?)`).run(id,uuid,player.username,latestAdd.id,discordUserId,reason.trim(),now);
 return id;
}
function decideAppeal(id,owner,approve){
 return db.transaction(()=>{
  const appeal=db.prepare(`SELECT * FROM strike_appeals WHERE appeal_id=?`).get(id);
  if(!appeal)throw new Error('Strike appeal not found');
  if(appeal.status!=='pending')throw new Error(`This appeal was already ${appeal.status}`);
  let result=null;
  if(approve){
   const original=db.prepare(`SELECT * FROM strike_actions WHERE id=? AND player_uuid=? AND action='add'`).get(appeal.strike_action_id,appeal.player_uuid);
   if(!original||original.applied_amount<=0)throw new Error('The strike being appealed is no longer available for reversal.');
   const currentTotal=getTotal.get(appeal.player_uuid)?.total||0;
   const amountToReverse=reversibleStrikeAmount(currentTotal,original.applied_amount);
   result=amountToReverse>0
    ? applyActionTx({actionId:`appeal-reversal:${id}`,playerUuid:appeal.player_uuid,username:appeal.username,action:'remove',amount:amountToReverse,
      reason:`Approved appeal: ${appeal.reason}`,source:'appeal',staffIdentity:owner})
    : {ok:true,username:appeal.username,appliedAmount:0,previousTotal:currentTotal,newTotal:currentTotal};
   db.prepare(`INSERT INTO minecraft_punishment_reversals(appeal_id,player_uuid,username,reason,created_at)
    VALUES(?,?,?,?,?)`).run(id,appeal.player_uuid,appeal.username,`Approved strike appeal: ${appeal.reason}`,new Date().toISOString());
  }
  const status=approve?'approved':'denied';
  db.prepare(`UPDATE strike_appeals SET status=?,decided_at=?,decided_by=?,result_json=? WHERE appeal_id=? AND status='pending'`)
   .run(status,new Date().toISOString(),owner,result?JSON.stringify(result):null,id);
  return {appeal,result};
 })();
}
async function syncActiveEntry(uuid){
 if(!client.isReady())return; const p=db.prepare(`SELECT p.uuid,p.username,s.total FROM players p JOIN strike_totals s ON s.player_uuid=p.uuid WHERE p.uuid=?`).get(uuid); if(!p)return;
 const channel=await client.channels.fetch(STRIKE_LOG_CHANNEL_ID).catch(()=>null); if(!channel?.isTextBased())return;
 const map=db.prepare(`SELECT message_id FROM discord_active_messages WHERE player_uuid=?`).get(uuid);
 if(p.total<=0){if(map){const m=await channel.messages.fetch(map.message_id).catch(()=>null);if(m)await m.delete().catch(()=>{});db.prepare(`DELETE FROM discord_active_messages WHERE player_uuid=?`).run(uuid);}return;}
 let m=map?await channel.messages.fetch(map.message_id).catch(()=>null):null; if(m)await m.edit({embeds:[activeEmbed(p)],components:activeRows(uuid)}); else {m=await channel.send({embeds:[activeEmbed(p)],components:activeRows(uuid)});db.prepare(`INSERT INTO discord_active_messages(player_uuid,message_id,updated_at) VALUES(?,?,?) ON CONFLICT(player_uuid) DO UPDATE SET message_id=excluded.message_id,updated_at=excluded.updated_at`).run(uuid,m.id,new Date().toISOString());}
}
async function syncAll(){for(const p of activePlayers())await syncActiveEntry(p.uuid); const rows=db.prepare(`SELECT player_uuid FROM discord_active_messages`).all();for(const r of rows){const t=getTotal.get(r.player_uuid);if(!t||t.total<=0)await syncActiveEntry(r.player_uuid);}}

const app=express(); app.use(express.json({limit:'32kb'}));
function auth(req,res,next){const h=req.get('authorization')||'';const expected=`Bearer ${API_SECRET}`;const a=Buffer.from(h),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});next();}
app.get('/health',(req,res)=>res.json({ok:true}));
app.use('/api/v1',auth);
function activeGoalSettingsEmbed(){
  const g=activePlayerGoal.snapshot();
  return new EmbedBuilder().setColor(0x5865f2).setTitle('Active Player Goal — Owner Controls')
    .setDescription('Set how many players must be visible on the Minecraft tab list at the same time, the daily time requirement, and any prize description. The timer counts only while the tab-list count meets the target. The prize is displayed for players; staff arrange it manually.')
    .addFields({name:'Current goal',value:`${g.targetPlayers} players · ${Math.round(g.requiredSeconds/60)} minutes per day`,inline:true},{name:'Current prize',value:g.prize||'No prize set',inline:true},{name:'Timezone',value:g.timezone,inline:true});
}
function activeGoalSettingsRows(){return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('activegoal:set').setLabel('Set Active Goal').setStyle(ButtonStyle.Primary))];}
function activeGoalProgressEmbed(){
  const g=activePlayerGoal.snapshot();
  const formatDuration=seconds=>{
    const totalMinutes=Math.floor(seconds/60);
    const hours=Math.floor(totalMinutes/60);
    const minutes=totalMinutes%60;
    return hours?`${hours}h ${minutes}m`:`${minutes}m`;
  };
  const progressBar=(value,max,segments=10)=>{
    const filled=Math.max(0,Math.min(segments,Math.floor((value/Math.max(1,max))*segments)));
    return `\`${'■'.repeat(filled)}${'□'.repeat(segments-filled)}\``;
  };
  const liveCount=g.sampleFresh
    ? `**${g.onlinePlayers} / ${g.targetPlayers}**\n${progressBar(g.onlinePlayers,g.targetPlayers,8)}`
    : `⏳ Waiting for Minecraft server data\n**Target: ${g.targetPlayers} players**`;
  const enoughPlayers=g.sampleFresh&&g.onlinePlayers>=g.targetPlayers;
  const remainingSeconds=Math.max(0,g.requiredSeconds-g.secondsToday);
  const todayProgress=g.dayQualified
    ? `✅ **Daily countdown complete**\n${progressBar(g.requiredSeconds,g.requiredSeconds,8)}\n**${formatDuration(g.requiredSeconds)} reached**`
    : `${enoughPlayers?'🟢 **Countdown active**':'⏸️ **Paused**'}\n${progressBar(g.secondsToday,g.requiredSeconds,8)}\n**${formatDuration(remainingSeconds)} remaining**${enoughPlayers?'':`\nNeed **${g.targetPlayers} players online** to start`}`;
  const streakProgress=`${progressBar(g.streak,7,7)}\n**${g.streak} / 7 days**`;

  return new EmbedBuilder().setColor(0x35c5b5)
    .setTitle('🏆 KIND SMP ACTIVE PLAYER GOAL')
    .setDescription(`**${g.targetPlayers} players online · ${formatDuration(g.requiredSeconds)} daily countdown · 7-day streak**\nPlayer goal tracking is active **24/7**. The countdown starts only after the player target is reached and pauses if the count drops below it.`)
    .addFields(
      {name:'👤 PLAYERS RIGHT NOW',value:liveCount,inline:true},
      {name:'⏱️ COUNTDOWN',value:todayProgress,inline:true},
      {name:'🔥 WEEKLY STREAK',value:streakProgress,inline:true},
      {name:'🎁 PRIZE',value:g.prize?`✨ **${g.prize}**`:'The owner has not chosen a prize yet.',inline:false}
    )
    .setThumbnail('https://mc-heads.net/avatar/Steve/128')
    .setFooter({text:`A missed day resets the streak · Timezone: ${g.timezone}`});
}
async function upsertGoalMessage(channelId,key,embed,components=[]){
  const channel=await client.channels.fetch(channelId).catch(()=>null);
  if(!channel?.isTextBased())throw new Error(`Active goal channel ${channelId} is unavailable`);
  const title=embed.data.title;
  const recent=await channel.messages.fetch({limit:100}).catch(()=>null);
  const matches=recent?[...recent.values()].filter(m=>m.author?.id===client.user.id&&m.embeds?.some(e=>e.title===title)):[];
  matches.sort((a,b)=>b.createdTimestamp-a.createdTimestamp);
  let message=matches[0]||null;
  for(const duplicate of matches.slice(1))await duplicate.delete().catch(()=>{});
  if(message)await message.edit({embeds:[embed],components});
  else message=await channel.send({embeds:[embed],components});
  db.prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,message.id);
  return message;
}
async function ensureActiveGoalPanels(){
  await upsertGoalMessage(ACTIVE_GOAL_MANAGEMENT_CHANNEL_ID,'active_goal_management_message_id',activeGoalSettingsEmbed(),activeGoalSettingsRows());
  await refreshActiveGoalProgress(true);
}
let lastGoalPanelEdit=0;
async function refreshActiveGoalProgress(force=false){
  if(!client?.isReady())return;
  const now=Date.now(); if(!force&&now-lastGoalPanelEdit<60000)return;
  lastGoalPanelEdit=now;
  try{await upsertGoalMessage(ACTIVE_GOAL_PROGRESS_CHANNEL_ID,'active_goal_progress_message_id',activeGoalProgressEmbed());}
  catch(error){console.error('Active player goal progress update failed:',error.message);}
}
function activeGoalModal(){
  const g=activePlayerGoal.snapshot();
  const modal=new ModalBuilder().setCustomId('activegoal:configure').setTitle('Configure Active Goal');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('players').setLabel('Players on tab list at the same time').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(g.targetPlayers))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('minutes').setLabel('Required minutes per day').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(Math.round(g.requiredSeconds/60)))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prize').setLabel('Prize (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200).setValue(g.prize||'')));
  return modal;
}
app.post('/api/v1/players/upsert',(req,res)=>{try{const {uuid,username}=req.body;if(!uuid||!username)return res.status(400).json({error:'uuid and username required'});upsertPlayer.run(uuid,username.trim(),normalizeName(username),new Date().toISOString());ensureTotal.run(uuid);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/v1/players/resolve',(req,res)=>{const p=getPlayerByName.get(normalizeName(String(req.query.username||'')));if(!p)return res.status(404).json({error:'Unknown player'});res.json(p);});
app.get('/api/v1/strikes/active',(req,res)=>res.json({players:activePlayers()}));
app.post('/api/v1/active-goal/sample',async(req,res)=>{
  try{
    const online=Number(req.body?.onlinePlayers);
    const progress=activePlayerGoal.recordSample(online);
    await refreshActiveGoalProgress();
    res.json({ok:true,progress:{day:progress.day,secondsToday:progress.secondsToday,streak:progress.streak,dayQualified:progress.dayQualified}});
  }catch(error){res.status(400).json({error:error.message});}
});
app.post('/api/v1/minecraft/status',(req,res)=>{
  if(req.body?.status==='offline')activePlayerGoal.markOffline();
  refreshActiveGoalProgress(true).catch(()=>{});
  res.json({ok:true});
});
// KindCore consumes the durable action log so strike changes made from Discord
// and Minecraft use the same punishment path without polling totals ambiguously.
app.get('/api/v1/strikes/actions',(req,res)=>{
  const after=Number(req.query.after||0), requestedLimit=Number(req.query.limit||50);
  if(!Number.isSafeInteger(after)||after<0)return res.status(400).json({error:'after must be a non-negative action cursor'});
  if(!Number.isSafeInteger(requestedLimit)||requestedLimit<1||requestedLimit>100)return res.status(400).json({error:'limit must be a whole number from 1 to 100'});
  const actions=db.prepare(`SELECT id,action_id AS actionId,player_uuid AS playerUuid,username_at_time AS username,action,applied_amount AS amount,previous_total AS previousTotal,new_total AS newTotal,reason,source,staff_identity AS staffIdentity,created_at AS createdAt FROM strike_actions WHERE id>? ORDER BY id ASC LIMIT ?`).all(after,requestedLimit)
    .map(action=>({...action,discordUserId:discordUserIdForPlayer(action.playerUuid),punishment:action.action==='add'?punishmentFor(action.newTotal):null}));
  const latestActionId=db.prepare(`SELECT COALESCE(MAX(id),0) AS id FROM strike_actions`).get().id;
  res.json({actions,nextCursor:actions.length?actions.at(-1).id:after,latestActionId,hasMore:actions.length===requestedLimit});
});
app.get('/api/v1/strikes/reversals',(req,res)=>{
  const limit=Number(req.query.limit||25);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)return res.status(400).json({error:'limit must be a whole number from 1 to 100'});
  const actions=db.prepare(`SELECT id,username,reason FROM minecraft_punishment_reversals WHERE status='queued' ORDER BY id ASC LIMIT ?`).all(limit);
  res.json({actions});
});
app.post('/api/v1/strikes/reversals/ack',(req,res)=>{
  const id=Number(req.body?.id),success=req.body?.success;
  if(!Number.isSafeInteger(id)||id<1||typeof success!=='boolean')return res.status(400).json({error:'id and success are required'});
  const error=String(req.body?.error||'').slice(0,300);
  const changed=success
    ? db.prepare(`UPDATE minecraft_punishment_reversals SET status='completed',last_error=NULL,completed_at=? WHERE id=? AND status='queued'`).run(new Date().toISOString(),id).changes
    : db.prepare(`UPDATE minecraft_punishment_reversals SET last_error=? WHERE id=? AND status='queued'`).run(error,id).changes;
  if(!changed)return res.status(404).json({error:'Queued punishment reversal not found'});
  res.json({ok:true});
});

const insertStaffRankAction = db.prepare(`INSERT OR IGNORE INTO minecraft_staff_rank_actions
 (app_id,discord_user_id,minecraft_uuid,minecraft_username,target_rank,minecraft_rank,status,created_at)
 VALUES(?,?,?,?,?,?, 'queued', ?)`);
global.__KIND_BOSS_QUEUE_STAFF_RANK = input => {
  if (!Number.isSafeInteger(input.appId) || input.appId < 1) throw new Error('Invalid staff application ID');
  if (!/^\d{17,20}$/.test(String(input.discordUserId || ''))) throw new Error('Invalid Discord user ID');
  if (!/^[0-9a-f-]{36}$/i.test(String(input.minecraftUuid || ''))) throw new Error('Invalid linked Minecraft UUID');
  if (!/^[A-Za-z0-9_]{1,16}$/.test(String(input.minecraftUsername || ''))) throw new Error('Invalid linked Minecraft username');
  if (!/^[a-z_]{1,32}$/.test(String(input.targetRank || '')) || !/^[a-z_]{1,32}$/.test(String(input.minecraftRank || ''))) throw new Error('Invalid staff rank mapping');
  insertStaffRankAction.run(input.appId,input.discordUserId,input.minecraftUuid,input.minecraftUsername,input.targetRank,input.minecraftRank,new Date().toISOString());
  return db.prepare('SELECT id,status FROM minecraft_staff_rank_actions WHERE app_id=?').get(input.appId);
};
app.get('/api/v1/staff/ranks/actions',(req,res)=>{
  const limit=Number(req.query.limit||25);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)return res.status(400).json({error:'limit must be a whole number from 1 to 100'});
  const actions=db.prepare(`SELECT id,app_id AS applicationId,discord_user_id AS discordUserId,minecraft_uuid AS minecraftUuid,
    minecraft_username AS username,target_rank AS targetRank,minecraft_rank AS minecraftRank
    FROM minecraft_staff_rank_actions WHERE status='queued' ORDER BY id ASC LIMIT ?`).all(limit);
  res.json({actions});
});
app.post('/api/v1/staff/ranks/actions/ack',(req,res)=>{
  const id=Number(req.body?.id),success=req.body?.success;
  if(!Number.isSafeInteger(id)||id<1||typeof success!=='boolean')return res.status(400).json({error:'id and success are required'});
  const error=String(req.body?.error||'').slice(0,300);
  const changed=success
    ? db.prepare(`UPDATE minecraft_staff_rank_actions SET status='completed',last_error=NULL,completed_at=? WHERE id=? AND status='queued'`).run(new Date().toISOString(),id).changes
    : db.prepare(`UPDATE minecraft_staff_rank_actions SET last_error=? WHERE id=? AND status='queued'`).run(error,id).changes;
  if(!changed)return res.status(404).json({error:'Queued staff rank action not found'});
  res.json({ok:true});
});

// Minecraft activity feed. Normal Minecraft chat is intentionally NOT accepted or posted.
app.post('/api/v1/minecraft/event', async (req,res) => {
  try {
    const { type, username, uuid, message, staffReason } = req.body || {};
    const allowedTypes = new Set(['server_online','server_offline','join','leave','advancement','death','staff_command','active_sample']);
    if (!allowedTypes.has(type)) return res.status(400).json({error:'Unsupported event type'});

    if(type==='active_sample'){
      const online=Number(req.body?.onlinePlayers);
      const progress=activePlayerGoal.recordSample(online);
      await refreshActiveGoalProgress();
      return res.json({ok:true,day:progress.day,secondsToday:progress.secondsToday,streak:progress.streak});
    }
    if(type==='server_offline'){
      activePlayerGoal.markOffline();
      await refreshActiveGoalProgress(true);
    }
    if(type==='server_online'){
      await refreshActiveGoalProgress(true);
    }

    if (type === 'staff_command') {
      if (!username || !uuid || !message) return res.status(400).json({error:'username, uuid, and command required'});
      const channel = await client.channels.fetch(STAFF_AUDIT_CHANNEL_ID).catch(() => null);
      if (!channel?.isTextBased()) return res.status(503).json({error:'Staff audit channel unavailable'});
      const embed = createStaffCommandEmbed(EmbedBuilder,{username,uuid,command:message,reason:staffReason});
      await channel.send({embeds:[embed],allowedMentions:{parse:[]}});
      return res.json({ok:true});
    }

    const channel = await client.channels.fetch(MINECRAFT_FEED_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) return res.status(503).json({error:'Minecraft feed channel unavailable'});

    let text;
    if (type === 'server_online') text = '🟢 KIND SMP is online';
    else if (type === 'server_offline') text = '🔴 KIND SMP is offline';
    else {
      if (!username || !uuid) return res.status(400).json({error:'username and uuid required'});
      if (type === 'join') text = `👋 ${username} joined the game`;
      if (type === 'leave') text = `👋 ${username} left the game`;
      if (type === 'advancement') text = `🏆 ${username} has made the advancement [${String(message || 'Advancement').slice(0,200)}]`;
      if (type === 'death') text = `☠️ ${String(message || `${username} died`).slice(0,300)}`;
    }

    const embed = new EmbedBuilder().setTimestamp();
    if (username && uuid) {
      // Discord always crops embed author icons into circles. Use the embed
      // thumbnail instead so the Minecraft player head stays square.
      const cleanUuid = String(uuid).replace(/-/g,'');
      embed
        .setDescription(`**${text}**`)
        .setThumbnail(`https://mc-heads.net/avatar/${cleanUuid}/64`);
    } else {
      embed.setDescription(`**${text}**`);
    }
    await channel.send({ embeds:[embed] });
    res.json({ok:true});
  } catch (e) {
    console.error('Minecraft feed error:', e);
    res.status(500).json({error:'Failed to post Minecraft event'});
  }
});
app.post(['/api/v1/strikes/action','/api/v1/strikes/propose'],async(req,res)=>{
  try {
    const proposalId=createProposal({...req.body,staffIdentity:req.body.staffIdentity||'Minecraft staff'});
    await publishProposal(proposalId);
    const proposal=db.prepare(`SELECT * FROM pending_strike_proposals WHERE proposal_id=?`).get(proposalId);
    res.status(202).json({ok:true,pending:true,proposalId,username:proposal.username,discordUserId:discordUserIdForPlayer(proposal.player_uuid),action:proposal.action,amount:proposal.amount,message:'Sent to the owner for approval; the strike total is unchanged until approval.'});
  } catch(e) { res.status(400).json({error:e.message}); }
});
app.listen(PORT,'0.0.0.0',()=>console.log(`KIND BOSS Strikes API listening on ${PORT}`));

function managementEmbed(){return new EmbedBuilder().setTitle('KIND SMP Strike Management').setDescription('Staff can add strikes, remove strikes, or view the current active-strike list. Minecraft and Discord use the same Railway database.');}
function managementRows(){return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('strike:add').setLabel('Add Strikes').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('strike:remove').setLabel('Remove Strikes').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('strike:view').setLabel('View Active Strikes').setStyle(ButtonStyle.Secondary))];}
async function ensurePanel(){
  const ch=await client.channels.fetch(STRIKE_MANAGEMENT_CHANNEL_ID);
  if(!ch?.isTextBased()) throw new Error('Management channel unavailable');
  // Railway's local SQLite state may reset between deploys. Discover the real Discord panel
  // instead of blindly creating a new one, and remove accidental duplicates.
  const recent=await ch.messages.fetch({limit:100}).catch(()=>null);
  const panels=recent ? [...recent.values()].filter(msg =>
    msg.author?.id===client.user.id &&
    msg.components?.some(row=>row.components?.some(c=>c.customId==='strike:add'))
  ) : [];
  panels.sort((a,b)=>b.createdTimestamp-a.createdTimestamp);
  let m=panels[0]||null;
  for(const duplicate of panels.slice(1)) await duplicate.delete().catch(()=>{});
  if(!m) m=await ch.send({embeds:[managementEmbed()],components:managementRows()});
  else await m.edit({embeds:[managementEmbed()],components:managementRows()});
  db.prepare(`INSERT INTO app_state(key,value) VALUES('panel_message_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(m.id);
}
function allowed(i){return i.guildId===GUILD_ID && STAFF_ROLE_IDS.some(id => i.member?.roles?.cache?.has(id));}
function owner(i){return i.guildId===GUILD_ID && i.member?.roles?.cache?.has(OWNER_ROLE_ID);}
const PAGE_SIZE = 25;
const allPlayers = () => db.prepare(`
  SELECT p.uuid, p.username, COALESCE(s.total, 0) AS total
  FROM players p
  LEFT JOIN strike_totals s ON s.player_uuid = p.uuid
  ORDER BY p.username COLLATE NOCASE
`).all().map(withDiscordLink);
const getPlayerByUuid = db.prepare(`
  SELECT p.uuid, p.username, COALESCE(s.total, 0) AS total
  FROM players p
  LEFT JOIN strike_totals s ON s.player_uuid = p.uuid
  WHERE p.uuid = ?
`);

function playerPicker(kind, page = 0) {
  const players = allPlayers();
  const pageCount = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pageCount - 1));
  const shown = players.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (!shown.length) {
    return {
      content: 'No SMP players have been synced yet. A player will appear here after the Paper plugin has synced their UUID and username.',
      components: []
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`strike:player:${kind}:${page}`)
    .setPlaceholder('Select an SMP member...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(shown.map(p => ({
      label: p.username.slice(0, 100),
      description: `Discord ${p.discordUserId || 'not application-linked'} · strikes ${p.total}`.slice(0, 100),
      value: p.uuid
    })));

  const rows = [new ActionRowBuilder().addComponents(menu)];

  if (pageCount > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`strike:players:${kind}:${page - 1}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`strike:players:${kind}:${page + 1}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1)
    ));
  }

  return {
    content: `Select an SMP member. Showing page **${page + 1}/${pageCount}** (${players.length} synced player${players.length === 1 ? '' : 's'}).`,
    components: rows
  };
}

function actionModal(kind, player) {
  const modal = new ModalBuilder()
    .setCustomId(`strike:modal:${kind}:${player.uuid}`)
    .setTitle(`${kind === 'add' ? 'Add Strikes' : 'Remove Strikes'} — ${player.username}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel(kind === 'add' ? 'Number of strikes' : 'Number to remove')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(7)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
    )
  );

  return modal;
}

function appealModal(uuid, username){
 const modal=new ModalBuilder().setCustomId(`strike:appeal-submit:${uuid}`).setTitle(`Appeal strike · ${username}`.slice(0,45));
 modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Why should this strike/punishment be reversed?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
 return modal;
}

client.once(Events.ClientReady, async () => {
  console.log(`Strike system logged in as ${client.user.tag}`);
  try { await ensureActiveGoalPanels(); }
  catch (error) { console.error('Active player goal panels could not be initialized:', error.message); }
  const activeGoalRefreshTimer=setInterval(()=>refreshActiveGoalProgress(true).catch(()=>{}),60000);
  activeGoalRefreshTimer.unref?.();
  try { await ensureApprovalChannel(); }
  catch (error) { console.error('Owner-only strike approval channel setup failed:', error.message); }
  await ensurePanel();
  await syncAll();
  await refreshPendingProposalPosts();
  await refreshPendingAppealPosts();
  retryProposalPosts();
  retryAppealPosts();
});

client.on(Events.InteractionCreate, async i=>{
  try{
    if((!i.isButton()&&!i.isModalSubmit())||typeof i.customId!=='string'||!i.customId.startsWith('activegoal:'))return;
    const isOwner=i.guildId===GUILD_ID&&(i.user.id===i.guild?.ownerId||i.member?.roles?.cache?.has(OWNER_ROLE_ID));
    if(!isOwner)return i.reply({content:'Only the server owner can set the active player goal.',flags:MessageFlags.Ephemeral});
    if(i.channelId!==ACTIVE_GOAL_MANAGEMENT_CHANNEL_ID)return i.reply({content:'Use the Active Goal controls in the configured goal management channel.',flags:MessageFlags.Ephemeral});
    if(i.isButton()&&i.customId==='activegoal:set')return i.showModal(activeGoalModal());
    if(i.isModalSubmit()&&i.customId==='activegoal:configure'){
      const playersText=i.fields.getTextInputValue('players').trim();
      const minutesText=i.fields.getTextInputValue('minutes').trim();
      const prize=i.fields.getTextInputValue('prize').trim();
      if(!/^\d+$/.test(playersText)||!/^\d+$/.test(minutesText))return i.reply({content:'Enter whole numbers for both fields.',flags:MessageFlags.Ephemeral});
      const settings=activePlayerGoal.setGoal(Number(playersText),Number(minutesText),prize);
      await ensureActiveGoalPanels();
      return i.reply({content:`Goal updated: ${settings.targetPlayers} players online for ${Math.round(settings.requiredSeconds/60)} minutes per day, seven consecutive days. Prize: ${settings.prize||'none set'}. Setting a new goal resets its current streak.`,flags:MessageFlags.Ephemeral});
    }
  }catch(error){
    console.error('Active player goal interaction failed:',error);
    if(!i.replied&&!i.deferred)await i.reply({content:'Could not update the active player goal. Please check the bot logs.',flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});

async function refreshPendingProposalPosts() {
  if (!client.isReady() || !strikeApprovalChannelId) return;
  for (const proposal of db.prepare(`SELECT proposal_id FROM pending_strike_proposals WHERE status='pending' ORDER BY created_at`).all()) {
    try { await publishProposal(proposal.proposal_id); }
    catch (error) { console.error('Could not refresh strike approval request:', error.message); break; }
  }
}

async function retryProposalPosts() {
  if (!client.isReady() || !strikeApprovalChannelId) return;
  for (const proposal of db.prepare(`SELECT proposal_id FROM pending_strike_proposals WHERE status='pending' AND message_id IS NULL ORDER BY created_at LIMIT 10`).all()) {
    try { await publishProposal(proposal.proposal_id); }
    catch (error) { console.error('Could not publish strike approval request:', error.message); break; }
  }
}
const proposalRetryTimer=setInterval(retryProposalPosts,30000);
proposalRetryTimer.unref?.();
async function refreshPendingAppealPosts(){
 if(!client.isReady()||!strikeApprovalChannelId)return;
 for(const appeal of db.prepare(`SELECT appeal_id FROM strike_appeals WHERE status='pending' ORDER BY created_at`).all()){
  try{await publishAppeal(appeal.appeal_id);}catch(error){console.error('Could not refresh pending strike appeal:',error.message);break;}
 }
}
async function retryAppealPosts(){
 if(!client.isReady()||!strikeApprovalChannelId)return;
 for(const appeal of db.prepare(`SELECT appeal_id FROM strike_appeals WHERE status='pending' AND message_id IS NULL ORDER BY created_at LIMIT 10`).all()){
  try{await publishAppeal(appeal.appeal_id);}catch(error){console.error('Could not publish strike appeal:',error.message);break;}
 }
}
const appealRetryTimer=setInterval(retryAppealPosts,30000);
appealRetryTimer.unref?.();

async function ensureApprovalChannel() {
  if (strikeApprovalChannelId) {
    const existing = await client.channels.fetch(strikeApprovalChannelId).catch(() => null);
    if (existing?.isTextBased()) return existing;
    throw new Error('STRIKE_APPROVAL_CHANNEL_ID does not point to an accessible text channel');
  }
  const guild = await client.guilds.fetch(GUILD_ID);
  const ownerRole = await guild.roles.fetch(OWNER_ROLE_ID).catch(() => null);
  if (!ownerRole) throw new Error('Owner role is unavailable; cannot lock down the approval channel');
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) throw new Error('The bot needs Manage Channels to create the private approval channel');
  const channel = await guild.channels.create({
    name: 'strike-approvals',
    type: ChannelType.GuildText,
    topic: 'Private owner-only queue for reviewing staff strike proposals.',
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: ownerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] }
    ],
    reason: 'Create the owner-only strike approval queue requested for Kind SMP'
  });
  strikeApprovalChannelId = channel.id;
  db.prepare(`INSERT INTO app_state(key,value) VALUES('strike_approval_channel_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(channel.id);
  console.log(`Created private owner-only strike approval channel ${channel.id}`);
  return channel;
}

client.on(Events.InteractionCreate, async i => {
  try {
    if (!i.isButton() && !i.isStringSelectMenu() && !i.isModalSubmit()) return;

    // IMPORTANT: This listener must ONLY handle Strike Management interactions.
    // Other KIND BOSS modules (staff applications, announcements, tickets, etc.)
    // have their own InteractionCreate listeners. Without this prefix guard, an
    // applicant clicking an `sa:` button gets rejected by strike permissions.
    if (typeof i.customId !== 'string' || !i.customId.startsWith('strike:')) return;

    if (i.isButton() && /^strike:(approve|deny)-proposal:/.test(i.customId)) {
      if (!owner(i)) return i.reply({content:'Only the owner can approve or deny strike proposals.',flags:MessageFlags.Ephemeral});
      const [,decision,id]=i.customId.split(':');
      if (decision==='approve-proposal') {
        const {proposal,result}=approveProposal(id,`${i.user.tag} (${i.user.id})`);
        await syncActiveEntry(proposal.player_uuid).catch(console.error);
        const punishment=result.punishment?` Punishment: ${result.punishment.type} for ${result.punishment.duration}.`:'';
        await i.message.edit({embeds:[EmbedBuilder.from(i.message.embeds[0]).setColor(0x22c55e)],components:[],content:`Approved by <@${i.user.id}> · ${proposal.action} ${result.appliedAmount} strike(s) for **${proposal.username}**. New total: **${result.newTotal}**.${punishment}`,allowedMentions:{parse:[]}});
        return i.reply({content:`Approved. **${proposal.username}** now has ${result.newTotal} strike(s).${punishment}`,flags:MessageFlags.Ephemeral});
      }
      const proposal=denyProposal(id,`${i.user.tag} (${i.user.id})`);
      await i.message.edit({embeds:[EmbedBuilder.from(i.message.embeds[0]).setColor(0xef4444)],components:[],content:`Denied by <@${i.user.id}> · No strike change was applied for **${proposal.username}**.`,allowedMentions:{parse:[]}});
      return i.reply({content:'Proposal denied. No strike was added or removed.',flags:MessageFlags.Ephemeral});
    }

    if (i.isButton() && i.customId.startsWith('strike:approve-appeal:')) {
      if (!owner(i)) return i.reply({content:'Only the owner can approve strike appeals and reverse punishments.',flags:MessageFlags.Ephemeral});
      const id=i.customId.slice('strike:approve-appeal:'.length);
      const {appeal,result}=decideAppeal(id,`${i.user.tag} (${i.user.id})`,true);
      await syncActiveEntry(appeal.player_uuid).catch(console.error);
      const reversal=db.prepare(`SELECT id FROM minecraft_punishment_reversals WHERE appeal_id=?`).get(id);
      const appealResult=`Appeal approved by <@${i.user.id}>. Removed ${result.appliedAmount} strike(s) from **${appeal.username}** (new total: ${result.newTotal}). Minecraft unban/unjail queued${reversal?` as reversal #${reversal.id}`:''}.`;
      await i.message.edit({embeds:[EmbedBuilder.from(i.message.embeds[0]).setColor(0x22c55e)],components:[],content:appealResult,allowedMentions:{parse:[]}});
      return i.reply({content:`✅ ${appealResult}`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
    }
    if (i.isButton() && i.customId.startsWith('strike:deny-appeal:')) {
      if (!owner(i)) return i.reply({content:'Only the owner can decide strike appeals.',flags:MessageFlags.Ephemeral});
      const id=i.customId.slice('strike:deny-appeal:'.length);
      const {appeal}=decideAppeal(id,`${i.user.tag} (${i.user.id})`,false);
      await syncActiveEntry(appeal.player_uuid).catch(console.error);
      await i.message.edit({embeds:[EmbedBuilder.from(i.message.embeds[0]).setColor(0xef4444)],components:[],content:`Appeal denied by <@${i.user.id}> for **${appeal.username}**. The strike and punishment were not changed.`,allowedMentions:{parse:[]}});
      return i.reply({content:'Appeal denied. No strike or punishment change was applied.',flags:MessageFlags.Ephemeral});
    }
    if (i.isButton() && i.customId.startsWith('strike:appeal:')) {
      const uuid=i.customId.slice('strike:appeal:'.length),linkedDiscord=discordUserIdForPlayer(uuid);
      if (!linkedDiscord || linkedDiscord!==i.user.id) return i.reply({content:'Only the Discord account linked to this Minecraft profile can submit its appeal.',flags:MessageFlags.Ephemeral});
      const player=getPlayerByUuid.get(uuid);
      if (!player || player.total<=0 || !latestAppealableStrike(uuid)) return i.reply({content:'There is no active strike available to appeal on this profile.',flags:MessageFlags.Ephemeral});
      if (db.prepare(`SELECT 1 FROM strike_appeals WHERE player_uuid=? AND status='pending'`).get(uuid)) return i.reply({content:'An appeal for this member is already awaiting the owner’s review.',flags:MessageFlags.Ephemeral});
      return i.showModal(appealModal(uuid,player.username));
    }
    if (i.isModalSubmit() && i.customId.startsWith('strike:appeal-submit:')) {
      const uuid=i.customId.slice('strike:appeal-submit:'.length);
      if (discordUserIdForPlayer(uuid)!==i.user.id) return i.reply({content:'Only the Discord account linked to this Minecraft profile can submit its appeal.',flags:MessageFlags.Ephemeral});
      const reason=i.fields.getTextInputValue('reason').trim();
      if (!reason) return i.reply({content:'Please explain why you believe the strike or punishment should be reversed.',flags:MessageFlags.Ephemeral});
      const id=createAppeal(uuid,i.user.id,reason);
      await publishAppeal(id);
      await syncActiveEntry(uuid).catch(console.error);
      return i.reply({content:'Your appeal was sent to the Owner for review. If approved, the strike will be corrected and the Minecraft ban/jail will be reversed.',flags:MessageFlags.Ephemeral});
    }

    if (!allowed(i)) {
      return i.reply({
        content: 'You do not have permission to use the strike management panel.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (i.isButton() && i.customId === 'strike:add') {
      return i.reply({ ...playerPicker('add', 0), flags: MessageFlags.Ephemeral });
    }

    if (i.isButton() && i.customId === 'strike:remove') {
      return i.reply({ ...playerPicker('remove', 0), flags: MessageFlags.Ephemeral });
    }

    if (i.isButton() && i.customId.startsWith('strike:players:')) {
      const [, , kind, pageRaw] = i.customId.split(':');
      const page = Number(pageRaw);
      if (!['add', 'remove'].includes(kind) || !Number.isInteger(page)) {
        return i.reply({ content: 'Invalid player-list request.', flags: MessageFlags.Ephemeral });
      }
      return i.update(playerPicker(kind, page));
    }

    if (i.isStringSelectMenu() && i.customId.startsWith('strike:player:')) {
      const [, , kind] = i.customId.split(':');
      if (!['add', 'remove'].includes(kind)) {
        return i.reply({ content: 'Invalid strike action.', flags: MessageFlags.Ephemeral });
      }

      const uuid = i.values[0];
      const player = getPlayerByUuid.get(uuid);
      if (!player) {
        return i.reply({
          content: 'That SMP player is no longer available in the strike database.',
          flags: MessageFlags.Ephemeral
        });
      }

      return i.showModal(actionModal(kind, withDiscordLink(player)));
    }

    if (i.isButton() && i.customId === 'strike:view') {
      const list = activePlayers();
      const text = list.length
        ? list.map(p => `**${p.username}** · ${p.discordUserId ? `<@${p.discordUserId}>` : 'No application link'} — ${p.total}`).join('\n')
        : 'No players currently have active strikes.';
      return i.reply({ content: text.slice(0, 1900), flags: MessageFlags.Ephemeral });
    }

    if (i.isModalSubmit() && i.customId.startsWith('strike:modal:')) {
      const parts = i.customId.split(':');
      const action = parts[2];
      const uuid = parts.slice(3).join(':');

      if (!['add', 'remove'].includes(action)) {
        return i.reply({ content: 'Invalid strike action.', flags: MessageFlags.Ephemeral });
      }

      const player = getPlayerByUuid.get(uuid);
      if (!player) {
        return i.reply({
          content: 'That SMP player could not be found in the strike database.',
          flags: MessageFlags.Ephemeral
        });
      }

      const linkedPlayer = withDiscordLink(player);

      const amountText = i.fields.getTextInputValue('amount').trim();
      if (!/^\d+$/.test(amountText)) {
        return i.reply({
          content: 'Amount must be a positive whole number.',
          flags: MessageFlags.Ephemeral
        });
      }

      const amount = Number(amountText);
      const reason = i.fields.getTextInputValue('reason').trim();

      if (!validAmount(amount)) {
        return i.reply({
          content: 'Amount must be a whole number from 1 to 1,000,000.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!reason) {
        return i.reply({ content: 'A reason is required.', flags: MessageFlags.Ephemeral });
      }

      const proposalId=createProposal({
        playerUuid: linkedPlayer.uuid,
        username: linkedPlayer.username,
        action,
        amount,
        reason,
        source: 'discord',
        staffIdentity: `${i.user.tag} (${i.user.id})`
      });
      await publishProposal(proposalId);
      const account = linkedPlayer.discordUserId ? `<@${linkedPlayer.discordUserId}>` : 'no approved application link found';
      return i.reply({content:`Strike ${action} proposal for Minecraft **${linkedPlayer.username}** (Discord: ${account}) sent to the owner for approval. No strike change is active yet. Proposal: ${proposalId.slice(0,8)}.`,flags:MessageFlags.Ephemeral});
    }
  } catch (e) {
    console.error(e);
    if (i.isRepliable() && !i.replied && !i.deferred) {
      await i.reply({
        content: 'The strike action failed. Check the Railway logs.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
});

