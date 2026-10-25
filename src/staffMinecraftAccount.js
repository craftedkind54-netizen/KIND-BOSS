'use strict';

function normalizeMinecraftUuid(value) {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/^\{|\}$/g, '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(compact)) return null;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`.toLowerCase();
}

function selectVerifiedMinecraftAccount(rows) {
  for (const row of rows || []) {
    const username = typeof row?.username === 'string' ? row.username.trim() : '';
    const uuid = normalizeMinecraftUuid(row?.uuid);
    if (/^[A-Za-z0-9_]{1,16}$/.test(username) && uuid) return { username, uuid };
  }
  return null;
}

module.exports = { normalizeMinecraftUuid, selectVerifiedMinecraftAccount };