'use strict';

const fs = require('node:fs');

function createApplicationDiscordLookup({ databasePath, DatabaseClass }) {
  let applicationDb = null;
  let lookup = null;

  function discordUserIdForPlayer(uuid) {
    if (!uuid || !fs.existsSync(databasePath)) return null;
    try {
      if (!applicationDb) {
        applicationDb = new DatabaseClass(databasePath, { readonly: true, fileMustExist: true });
        if (typeof applicationDb.pragma === 'function') applicationDb.pragma('busy_timeout = 2000');
        else applicationDb.exec('PRAGMA busy_timeout = 2000');
        lookup = applicationDb.prepare(`
          SELECT user_id
          FROM applications
          WHERE uuid = ? AND state IN ('ready', 'superseded')
          ORDER BY CASE state WHEN 'ready' THEN 0 ELSE 1 END, decided DESC
          LIMIT 1
        `);
      }
      return lookup.get(uuid)?.user_id || null;
    } catch {
      // The importer may not have run yet, or an older database may not have
      // the application schema. Keep strike handling available without a link.
      try { applicationDb?.close(); } catch {}
      applicationDb = null;
      lookup = null;
      return null;
    }
  }
  discordUserIdForPlayer.close = () => {
    try { applicationDb?.close(); } catch {}
    applicationDb = null;
    lookup = null;
  };
  return discordUserIdForPlayer;
}

module.exports = { createApplicationDiscordLookup };
