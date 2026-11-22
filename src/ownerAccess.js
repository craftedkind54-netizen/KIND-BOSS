'use strict';

const { isAnnouncementOwnerOrCoOwner } = require('./announcementPolicy');

// Owner and Co-Owner have the same bot powers: strike approvals and appeals, punishment reversals,
// staff application Pass/Fail and announcement scheduling, and the active player goal.
// Matches the Discord server owner, OWNER_ROLE_ID / CO_OWNER_ROLE_ID, or a role named Owner / Co-Owner
// (so it still works when CO_OWNER_ROLE_ID isn't set in Railway).
function isOwnerLevel(member, { guild, userId, ownerRoleId, coOwnerRoleId } = {}) {
  const g = guild || member?.guild;
  const id = userId || member?.id || member?.user?.id;
  if (g?.ownerId && id && g.ownerId === id) return true;
  return isAnnouncementOwnerOrCoOwner(member, { owner: ownerRoleId, coOwner: coOwnerRoleId });
}

const CO_OWNER_NAMES = new Set(['co-owner', 'co owner', 'coowner']);

// The Co-Owner role object, by CO_OWNER_ROLE_ID or by name. Null when neither is found.
async function findCoOwnerRole(guild, coOwnerRoleId) {
  if (!guild) return null;
  if (coOwnerRoleId) {
    const byId = await guild.roles.fetch(coOwnerRoleId).catch(() => null);
    if (byId) return byId;
  }
  const roles = await guild.roles.fetch().catch(() => null);
  if (!roles) return null;
  return Array.from(roles.values()).find(role =>
    CO_OWNER_NAMES.has(String(role?.name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'))) || null;
}

module.exports = { isOwnerLevel, findCoOwnerRole };
