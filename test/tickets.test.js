const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const discord = require('discord.js');
function fixture(options = {}) {
  const bot = { user: { id: '111111111111111111' }, on() {}, once() {} };
  const context = { require, console: { log() {}, error() {} }, Buffer, setTimeout,
    global: { __KIND_BOSS_CLIENT: bot }, process: { env: { DISCORD_TOKEN: 'test' }, on() {} } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/tickets.js'), 'utf8') + '\nthis.api = {createTicket, ticketCreationErrorMessage};', context);
  const roleIds = ['1555840026607362099', '1555839917815238736', '1555827222688829441'];
  const member = { id: '222222222222222222', user: { username: 'Player', tag: 'Player' }, toString() { return '<@' + this.id + '>'; } };
  const selected = { id: '333333333333333333', user: {bot: false}, roles: {cache: new Map([[roleIds[0], {}]])} };
  const channel = { id: '444444444444444444', async send() { if (options.sendError) throw options.sendError; }, toString() {return '<#' + this.id + '>';} };
  const calls = [];
  const guild = { id: '1555704317552361563',
    roles: { everyone: {id:'1555704317552361563'}, async fetch() {return new Map((options.roles ?? roleIds).map(id=>[id,{}]));} },
    members: { async fetch() { return selected; } },
    channels: {cache: {find() {return options.existing;}},
      async fetch() {return options.category === false ? null : {type:discord.ChannelType.GuildCategory};},
      async create(payload) { calls.push(payload); if(options.createError) throw options.createError; return channel; }
    }
  };
  const create = overrides => context.api.createTicket({guild,member,type:'all_staff',allowedRoles:roleIds,...overrides});
  return {create,calls,selected,channel,roleIds,api:context.api};
}
test('all staff: duplicate owner fallback deduplicated and every overwrite resolves with empty caches', async()=>{
 const f=fixture(); assert.equal((await f.create()).success,true);
 const entries=f.calls[0].permissionOverwrites;
 assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 const emptyGuild={roles:{resolve(){return null;}},client:{users:{resolve(){return null;}}}};
 for(const entry of entries) assert.doesNotThrow(()=>discord.PermissionOverwrites.resolve(entry,emptyGuild));
 assert.equal(entries.find(e=>e.id==='1555704317552361563').deny[0],discord.PermissionFlagsBits.ViewChannel);
 assert.equal(entries.filter(e=>e.type===0&&e.allow).length,3);
});
test('specific staff: only selected members get access and staff roles are denied',async()=>{
 const f=fixture(); assert.equal((await f.create({type:'specific_staff',allowedRoles:[],allowedUsers:[f.selected.id,f.selected.id]})).success,true);
 const entries=f.calls[0].permissionOverwrites;
 assert.equal(entries.filter(e=>e.id===f.selected.id).length,1);
 for(const id of f.roleIds) assert.ok(entries.find(e=>e.id===id).deny);
 assert.equal(entries.find(e=>e.id===f.selected.id).type,1);
});
test('deleted optional roles skipped; all roles missing stops creation',async()=>{
 const one=fixture({roles:['1555840026607362099']}); assert.equal((await one.create()).success,true);
 const none=fixture({roles:[]}); assert.match((await none.create()).message,/No valid support staff/); assert.equal(none.calls.length,0);
});
test('invalid category stops creation with actionable response',async()=>{
 const f=fixture({category:false}); assert.match((await f.create()).message,/ticket category/); assert.equal(f.calls.length,0);
});
test('permission error is actionable and releases creation lock',async()=>{
 const f=fixture({createError:{code:50013}}); assert.match((await f.create()).message,/Manage Channels/);
 await f.create(); assert.equal(f.calls.length,2);
});
test('failed welcome retains existing channel and reports its link',async()=>{
 const f=fixture({sendError:Error('failed')}); const result=await f.create();
 assert.equal(result.success,true); assert.equal(result.channel,f.channel); assert.match(result.message,/welcome message/); assert.equal(f.calls.length,1);
});
test('existing ticket does not create a duplicate',async()=>{
 const f=fixture({existing:'<#444444444444444444>'}); assert.match((await f.create()).message,/already have/); assert.equal(f.calls.length,0);
});
test('stale selected staff rejected before granting permissions',async()=>{
 const f=fixture(); f.selected.roles.cache.clear(); assert.match((await f.create({type:'specific_staff',allowedRoles:[],allowedUsers:[f.selected.id]})).message,/no longer available/); assert.equal(f.calls.length,0);
});
test('category/channel limits and invalid settings have distinct messages',()=>{
 const f=fixture(); assert.match(f.api.ticketCreationErrorMessage({code:30013}),/limit/);
 assert.match(f.api.ticketCreationErrorMessage({code:10003}),/no longer exists/);
 assert.match(f.api.ticketCreationErrorMessage({code:50035}),/settings/);
});
