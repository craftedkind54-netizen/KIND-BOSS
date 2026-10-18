'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createApplicationDiscordLookup({ databasePath, databasePaths = [], DatabaseClass }) {
  const candidates = [...new Set([databasePath, ...databasePaths]
    .filter(Boolean).map(candidate => path.resolve(candidate)))];
  const databases = new Map();

  function openDatabase(candidate) {
    if (databases.has(candidate)) return databases.get(candidate);
    if (!fs.existsSync(candidate)) return null;
    let db;
    try {
      db = new DatabaseClass(candidate, { readonly: true, fileMustExist: true });
      if (typeof db.pragma === 'function') db.pragma('busy_timeout = 2000');
      else db.exec('PRAGMA busy_timeout = 2000');
      const lookup = db.prepare(`
        SELECT user_id
        FROM applications
        WHERE lower(replace(uuid, '-', '')) = lower(replace(?, '-', ''))
          AND state IN ('ready', 'superseded')
        ORDER BY CASE state WHEN 'ready' THEN 0 ELSE 1 END, decided DESC
        LIMIT 1
      `);
      const entry = { db, lookup };
      databases.set(candidate, entry);
      return entry;
    } catch {
      // A wrong/missing mount or an older database schema should not stop the
      // bot. Try the remaining known locations and return no link if none fit.
      try { db?.close(); } catch {}
      return null;
    }
  }

  function discordUserIdForPlayer(uuid) {
    if (!uuid) return null;
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      const entry = openDatabase(candidate);
      if (!entry) continue;
      try {
        const userId = entry.lookup.get(String(uuid))?.user_id;
        if (userId) return userId;
      } catch {
        try { entry.db.close(); } catch {}
        databases.delete(candidate);
      }
    }
    return null;
  }

  discordUserIdForPlayer.close = () => {
    for (const { db } of databases.values()) {
      try { db.close(); } catch {}
    }
    databases.clear();
  };
  return discordUserIdForPlayer;
}

module.exports = { createApplicationDiscordLookup };
