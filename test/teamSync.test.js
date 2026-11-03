'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createTeamSync, parseTeamSnapshot, normalizeColor, channelNameFor } = require('../src/teamSync');

const ChannelType = { GuildText: 0, GuildCategory: 4 };
const PermissionFlagsBits = { ViewChannel: 1n, SendMessages: 2n, ReadMessageHistory: 4n, AttachFiles: 8n, EmbedLinks: 16n,
  AddReactions: 32n, ManageChannels: 64n, ManageMessages: 128n, ManageRoles: 256n };

function fakeGuild({ perms = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels] } = {}) {
  let next = 100;
  const roles = new Map(), channels = new Map(), members = new Map();
  const memberObj = id => {
    const set = new Set();
    return { id, roles: { cache: { has: r => set.has(r) }, add: async r => set.add(r.id ?? r), remove: async r => set.delete(r.id ?? r) }, _roles: set };
  };
  const guild = {
    id: 'guild',
    roles: {
      fetch: async id => roles.get(id) ?? null,
      create: async o => { const role = { id: String(next++), name: o.name, colors: { primaryColor: o.colors.primaryColor },
        edit: async e => Object.assign(role, { name: e.name, colors: { primaryColor: e.colors.primaryColor } }),
        delete: async () => { roles.delete(role.id); for (const m of members.values()) m._roles.delete(role.id); } };
        roles.set(role.id, role); return role; },
    },
    channels: {
      fetch: async id => channels.get(id) ?? null,
      create: async o => { const ch = { id: String(next++), ...o, edit: async e => Object.assign(ch, e) }; channels.set(ch.id, ch); return ch; },
    },
    members: {
      fetch: async id => members.get(id) ?? null,
      fetchMe: async () => ({ id: 'bot', permissions: { has: p => perms.includes(p) } }),
    },
  };
  for (const id of ['d-alice', 'd-bob', 'd-cara']) members.set(id, memberObj(id));
  return { guild, roles, channels, members };
}

const links = { 'aaaaaaaa-0000-4000-8000-000000000001': 'd-alice', 'aaaaaaaa-0000-4000-8000-000000000002': 'd-bob',
  'aaaaaaaa-0000-4000-8000-000000000003': 'd-cara' };
const TEAM = 'bbbbbbbb-0000-4000-8000-000000000001';
const snap = (teams) => ({ type: 'team_sync', teams });
const member = (n, name) => ({ uuid: `aaaaaaaa-0000-4000-8000-00000000000${n}`, username: name });

function setup(opts) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const g = fakeGuild(opts);
  const errors = [];
  const sync = createTeamSync({ db, getGuild: async () => g.guild, discordUserIdForPlayer: u => links[u] ?? null,
    adminRoleIds: ['owner-role', 'coowner-role'], discord: { ChannelType, PermissionFlagsBits }, log: { error: m => errors.push(m) } });
  return { db, g, sync, errors };
}

test('colours follow Minecraft names and aliases', () => {
  assert.equal(normalizeColor('Purple'), 'dark_purple');
  assert.equal(normalizeColor('pink'), 'light_purple');
  assert.equal(normalizeColor('dark-grey'), 'dark_gray');
  assert.equal(normalizeColor('rainbow'), null);
  assert.equal(normalizeColor(undefined), null);
  assert.equal(channelNameFor('The Dragons!'), 'team-the-dragons');
});

test('rejects malformed snapshots so KindCore sees a clear 400', () => {
  assert.throws(() => parseTeamSnapshot({ type: 'team_sync' }));
  assert.throws(() => parseTeamSnapshot(snap([{ id: 'nope', name: 'x', members: [] }])));
  assert.throws(() => parseTeamSnapshot(snap([{ id: TEAM, name: 'a', members: [] }, { id: TEAM, name: 'b', members: [] }])));
  const [t] = parseTeamSnapshot(snap([{ id: TEAM, name: 'Reds', color: 'red', members: [member(1, 'Alice'), { uuid: 'bad', username: 'x' }] }]));
  assert.deepEqual(t.members.map(m => m.username), ['Alice']);
  assert.equal(t.name, 'reds');
});

test('creates a coloured role and a private channel, and gives the role to linked members', async () => {
  const { g, sync } = setup();
  const summary = await sync.enqueue(snap([{ id: TEAM, name: 'reds', color: 'red', members: [member(1, 'Alice'), member(2, 'Bob'),
    { uuid: 'cccccccc-0000-4000-8000-000000000009', username: 'NoDiscord' }] }]));
  assert.deepEqual(summary, { teams: 1, added: 2, removed: 0, unlinked: 1, archived: 0, errors: 0 });
  const role = [...g.roles.values()][0];
  assert.equal(role.name, 'Team reds');
  assert.equal(role.colors.primaryColor, 0xff5555);
  const channel = [...g.channels.values()].find(c => c.type === ChannelType.GuildText);
  const category = [...g.channels.values()].find(c => c.type === ChannelType.GuildCategory);
  assert.equal(channel.name, 'team-reds');
  assert.equal(channel.parent, category.id);
  const ow = Object.fromEntries(channel.permissionOverwrites.map(o => [o.id, o]));
  assert.ok(ow.guild.deny.includes(PermissionFlagsBits.ViewChannel), '@everyone cannot see it');
  for (const id of [role.id, 'owner-role', 'coowner-role', 'bot']) assert.ok(ow[id].allow.includes(PermissionFlagsBits.ViewChannel), `${id} can see it`);
  assert.ok(g.members.get('d-alice').roles.cache.has(role.id));
  assert.ok(g.members.get('d-bob').roles.cache.has(role.id));
  assert.ok(!g.members.get('d-cara').roles.cache.has(role.id));
});

test('later syncs move members, recolour, and archive disbanded teams without deleting history', async () => {
  const { g, sync } = setup();
  const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
  await sync.enqueue(snap([{ id: TEAM, name: 'reds', color: 'red', members: [member(1, 'Alice'), member(2, 'Bob')] },
    { id: OTHER, name: 'blues', color: 'blue', members: [member(3, 'Cara')] }]));
  const redRole = [...g.roles.values()].find(r => r.name === 'Team reds');
  // Bob leaves, team turns gold; blues disband.
  const s2 = await sync.enqueue(snap([{ id: TEAM, name: 'reds', color: 'gold', members: [member(1, 'Alice')] }]));
  assert.equal(s2.removed, 1);
  assert.equal(s2.archived, 1);
  assert.ok(!g.members.get('d-bob').roles.cache.has(redRole.id));
  assert.equal(redRole.colors.primaryColor, 0xffaa00);
  assert.equal([...g.roles.values()].some(r => r.name === 'Team blues'), false, 'disbanded role removed');
  assert.ok([...g.channels.values()].some(c => c.name === 'archived-team-blues'), 'channel kept for admins');
  // No changes => no Discord edits needed for members.
  const s3 = await sync.enqueue(snap([{ id: TEAM, name: 'reds', color: 'gold', members: [member(1, 'Alice')] }]));
  assert.deepEqual([s3.added, s3.removed, s3.archived, s3.errors], [0, 0, 0, 0]);
});

test('an empty snapshot never archives existing teams', async () => {
  const { g, sync } = setup();
  await sync.enqueue(snap([{ id: TEAM, name: 'reds', color: 'red', members: [member(1, 'Alice')] }]));
  const s = await sync.enqueue(snap([]));
  assert.equal(s.archived, 0);
  assert.equal(g.roles.size, 1);
});

test('a team with no colour yet still gets a role', async () => {
  const { g, sync } = setup();
  await sync.enqueue(snap([{ id: TEAM, name: 'greys', members: [member(1, 'Alice')] }]));
  assert.equal([...g.roles.values()][0].colors.primaryColor, 0);
});

test('missing bot permissions fail loudly instead of half-applying', async () => {
  const { sync } = setup({ perms: [PermissionFlagsBits.ManageChannels] });
  await assert.rejects(sync.enqueue(snap([{ id: TEAM, name: 'reds', color: 'red', members: [] }])), /Manage Roles/);
});
