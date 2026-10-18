'use strict';

const ROLE_NAME_FALLBACKS = Object.freeze({
  general: ['general staff', 'staff']
});

async function resolveStaffRole(guild, targetRank, configuredRoleId) {
  if (configuredRoleId) {
    const configured = await guild.roles.fetch(configuredRoleId).catch(() => null);
    if (configured) return configured;
  }

  const fallbackNames = ROLE_NAME_FALLBACKS[targetRank];
  if (!fallbackNames?.length) return null;

  await guild.roles.fetch().catch(() => null);
  const aliases = new Set(fallbackNames.map(normalizeRoleName));
  return Array.from(guild.roles.cache.values()).find(role => aliases.has(normalizeRoleName(role.name))) || null;
}

function normalizeRoleName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

module.exports = { resolveStaffRole };
