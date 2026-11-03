'use strict';

// Mirrors KindCore's Minecraft teams into Discord:
//   * one role per team, coloured like the team's Minecraft colour, given to
//     every team member whose Minecraft account is linked to Discord;
//   * one private text channel per team that only that role, the Owner and
//     Co-Owner roles (and Discord administrators) can see.
// KindCore posts a full snapshot at startup and every ten minutes, so each
// sync converges Discord to the snapshot rather than applying deltas.

const MINECRAFT_COLORS = Object.freeze({
  black: 0x010101, // Discord treats 0 as "no colour", so use the nearest visible black.
  dark_blue: 0x0000aa,
  dark_green: 0x00aa00,
  dark_aqua: 0x00aaaa,
  dark_red: 0xaa0000,
  dark_purple: 0xaa00aa,
  gold: 0xffaa00,
  gray: 0xaaaaaa,
  dark_gray: 0x555555,
  blue: 0x5555ff,
  green: 0x55ff55,
  aqua: 0x55ffff,
  red: 0xff5555,
  light_purple: 0xff55ff,
  yellow: 0xffff55,
  white: 0xffffff,
});
const COLOR_ALIASES = Object.freeze({ purple: 'dark_purple', pink: 'light_purple', grey: 'gray', dark_grey: 'dark_gray' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEAM_NAME_RE = /^[\p{L}\p{N}_ .-]{1,32}$/u;
const MC_NAME_RE = /^\.?[A-Za-z0-9_]{1,16}$/;

function normalizeColor(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const key = value.trim().toLowerCase().replace(/-/g, '_');
  const name = COLOR_ALIASES[key] || key;
  return Object.hasOwn(MINECRAFT_COLORS, name) ? name : null;
}

function parseTeamSnapshot(body) {
  if (!body || body.type !== 'team_sync' || !Array.isArray(body.teams) || body.teams.length > 200) {
    throw new Error('Invalid team_sync payload');
  }
  const seen = new Set();
  return body.teams.map(team => {
    if (!team || !UUID_RE.test(team.id || '') || typeof team.name !== 'string' || !TEAM_NAME_RE.test(team.name)) {
      throw new Error('Invalid team in team_sync payload');
    }
    const id = team.id.toLowerCase();
    if (seen.has(id)) throw new Error('Duplicate team in team_sync payload');
    seen.add(id);
    if (!Array.isArray(team.members) || team.members.length > 200) throw new Error('Invalid team members in team_sync payload');
    const members = [];
    const memberIds = new Set();
    for (const m of team.members) {
      if (!m || !UUID_RE.test(m.uuid || '') || !MC_NAME_RE.test(m.username || '')) continue;
      const uuid = m.uuid.toLowerCase();
      if (memberIds.has(uuid)) continue;
      memberIds.add(uuid);
      members.push({ uuid, username: m.username });
    }
    return { id, name: team.name.toLowerCase(), color: normalizeColor(team.color), members };
  });
}

function channelNameFor(teamName) {
  const slug = teamName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'team';
  return `team-${slug}`.slice(0, 100);
}
const roleNameFor = teamName => `Team ${teamName}`.slice(0, 100);

function createTeamSyncStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_teams (
      team_id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT,
      role_id TEXT, channel_id TEXT, archived INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discord_team_members (
      team_id TEXT NOT NULL, discord_user_id TEXT NOT NULL, minecraft_uuid TEXT NOT NULL,
      PRIMARY KEY (team_id, discord_user_id)
    );
  `);
  return {
    team: id => db.prepare('SELECT * FROM discord_teams WHERE team_id=?').get(id),
    activeTeams: () => db.prepare('SELECT * FROM discord_teams WHERE archived=0').all(),
    saveTeam: t => db.prepare(`INSERT INTO discord_teams(team_id,name,color,role_id,channel_id,archived,updated_at) VALUES(@team_id,@name,@color,@role_id,@channel_id,@archived,@updated_at)
      ON CONFLICT(team_id) DO UPDATE SET name=excluded.name,color=excluded.color,role_id=excluded.role_id,channel_id=excluded.channel_id,archived=excluded.archived,updated_at=excluded.updated_at`)
      .run({ ...t, updated_at: new Date().toISOString() }),
    grantedMembers: id => db.prepare('SELECT * FROM discord_team_members WHERE team_id=?').all(id),
    addMember: (id, userId, uuid) => db.prepare('INSERT OR REPLACE INTO discord_team_members(team_id,discord_user_id,minecraft_uuid) VALUES(?,?,?)').run(id, userId, uuid),
    removeMember: (id, userId) => db.prepare('DELETE FROM discord_team_members WHERE team_id=? AND discord_user_id=?').run(id, userId),
    clearMembers: id => db.prepare('DELETE FROM discord_team_members WHERE team_id=?').run(id),
    getState: key => db.prepare('SELECT value FROM app_state WHERE key=?').get(key)?.value || '',
    setState: (key, value) => db.prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value),
  };
}

/**
 * @param {object} deps
 * @param {() => Promise<import('discord.js').Guild>} deps.getGuild
 * @param {(uuid:string) => string|null} deps.discordUserIdForPlayer
 * @param {string[]} deps.adminRoleIds  Owner / Co-Owner roles that can see every team channel.
 * @param {object} deps.discord  { ChannelType, PermissionFlagsBits }
 */
function createTeamSync({ db, getGuild, discordUserIdForPlayer, adminRoleIds = [], categoryId = '', discord, log = console }) {
  const store = createTeamSyncStore(db);
  const { ChannelType, PermissionFlagsBits } = discord;
  const memberAllow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions];
  let queue = Promise.resolve();

  async function ensureCategory(guild) {
    const wanted = categoryId || store.getState('team_category_id');
    if (wanted) {
      const existing = await guild.channels.fetch(wanted).catch(() => null);
      if (existing && existing.type === ChannelType.GuildCategory) return existing;
    }
    const category = await guild.channels.create({
      name: 'Teams', type: ChannelType.GuildCategory,
      permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }],
      reason: 'Kind SMP team channels',
    });
    store.setState('team_category_id', category.id);
    return category;
  }

  function overwritesFor(guild, roleId, me) {
    return [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: roleId, allow: memberAllow },
      ...adminRoleIds.filter(Boolean).map(id => ({ id, allow: memberAllow })),
      { id: me.id, allow: [...memberAllow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    ];
  }

  async function ensureRole(guild, record, team) {
    const color = team.color ? MINECRAFT_COLORS[team.color] : 0;
    let role = record?.role_id ? await guild.roles.fetch(record.role_id).catch(() => null) : null;
    if (!role) {
      role = await guild.roles.create({ name: roleNameFor(team.name), colors: { primaryColor: color }, hoist: false, mentionable: true,
        permissions: [], reason: `Kind SMP team ${team.name}` });
      if (record) store.clearMembers(team.id); // a fresh role has no members yet
      return role;
    }
    const roleColor = role.colors?.primaryColor;
    if (role.name !== roleNameFor(team.name) || roleColor !== color) {
      role = await role.edit({ name: roleNameFor(team.name), colors: { primaryColor: color }, reason: `Kind SMP team ${team.name} changed` });
    }
    return role;
  }

  async function ensureChannel(guild, record, team, role, category, me) {
    const name = channelNameFor(team.name);
    const permissionOverwrites = overwritesFor(guild, role.id, me);
    let channel = record?.channel_id ? await guild.channels.fetch(record.channel_id).catch(() => null) : null;
    if (!channel) {
      return guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, permissionOverwrites,
        topic: `Private channel for Kind SMP team ${team.name}.`, reason: `Kind SMP team ${team.name}` });
    }
    // Re-apply permissions every sync: a role re-created after deletion has a new id.
    await channel.edit({ name, parent: category.id, permissionOverwrites, reason: `Kind SMP team ${team.name} sync` });
    return channel;
  }

  async function syncMembers(guild, team, role) {
    const desired = new Map();
    let unlinked = 0;
    for (const m of team.members) {
      const userId = discordUserIdForPlayer(m.uuid);
      if (userId) desired.set(String(userId), m.uuid); else unlinked++;
    }
    let added = 0, removed = 0;
    for (const [userId, uuid] of desired) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue; // left the Discord server
      if (!member.roles.cache.has(role.id)) { await member.roles.add(role, `Joined Minecraft team ${team.name}`); added++; }
      store.addMember(team.id, userId, uuid);
    }
    for (const granted of store.grantedMembers(team.id)) {
      if (desired.has(granted.discord_user_id)) continue;
      const member = await guild.members.fetch(granted.discord_user_id).catch(() => null);
      if (member?.roles.cache.has(role.id)) { await member.roles.remove(role, `Left Minecraft team ${team.name}`); removed++; }
      store.removeMember(team.id, granted.discord_user_id);
    }
    return { added, removed, unlinked };
  }

  async function archiveTeam(guild, record) {
    // Keep the channel and its history; deleting the role leaves it visible to admins only.
    if (record.role_id) {
      const role = await guild.roles.fetch(record.role_id).catch(() => null);
      if (role) await role.delete(`Minecraft team ${record.name} no longer exists`);
    }
    if (record.channel_id) {
      const channel = await guild.channels.fetch(record.channel_id).catch(() => null);
      if (channel) await channel.edit({ name: `archived-${channelNameFor(record.name)}`.slice(0, 100), reason: `Minecraft team ${record.name} disbanded` });
    }
    store.clearMembers(record.team_id);
    store.saveTeam({ ...record, role_id: null, archived: 1 });
  }

  async function apply(teams) {
    const guild = await getGuild();
    const me = await guild.members.fetchMe();
    const missing = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels].filter(p => !me.permissions.has(p));
    if (missing.length) throw new Error('KIND BOSS needs the Manage Roles and Manage Channels permissions for team sync');
    const category = teams.length ? await ensureCategory(guild) : null;
    const summary = { teams: teams.length, added: 0, removed: 0, unlinked: 0, archived: 0, errors: 0 };
    for (const team of teams) {
      try {
        const record = store.team(team.id);
        const role = await ensureRole(guild, record, team);
        store.saveTeam({ team_id: team.id, name: team.name, color: team.color, role_id: role.id, channel_id: record?.channel_id || null, archived: 0 });
        const channel = await ensureChannel(guild, store.team(team.id), team, role, category, me);
        store.saveTeam({ team_id: team.id, name: team.name, color: team.color, role_id: role.id, channel_id: channel.id, archived: 0 });
        const r = await syncMembers(guild, team, role);
        summary.added += r.added; summary.removed += r.removed; summary.unlinked += r.unlinked;
      } catch (error) {
        summary.errors++;
        log.error(`Team sync failed for ${team.name}: ${error.message || error}`);
      }
    }
    // An empty snapshot is far more likely to be a read failure in the plugin
    // than every team disbanding at once, so only archive against a non-empty one.
    if (teams.length) {
      const present = new Set(teams.map(t => t.id));
      for (const record of store.activeTeams()) {
        if (present.has(record.team_id)) continue;
        try { await archiveTeam(guild, record); summary.archived++; }
        catch (error) { summary.errors++; log.error(`Could not archive team ${record.name}: ${error.message || error}`); }
      }
    }
    return summary;
  }

  /** Validates synchronously (throws on a bad payload), then applies in order in the background. */
  function enqueue(body) {
    const teams = parseTeamSnapshot(body);
    const run = queue.then(() => apply(teams));
    queue = run.catch(error => log.error(`Team sync failed: ${error.message || error}`));
    return run;
  }

  return { enqueue, apply, store };
}

module.exports = { createTeamSync, parseTeamSnapshot, normalizeColor, channelNameFor, roleNameFor, MINECRAFT_COLORS };
