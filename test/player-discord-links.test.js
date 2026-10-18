const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApplicationDiscordLookup } = require('../src/playerDiscordLinks');

class DatabaseAdapter {
  constructor(databasePath, options = {}) {
    this.db = new DatabaseSync(databasePath, { readOnly: options.readonly === true });
  }
  exec(sql) { return this.db.exec(sql); }
  prepare(sql) { return this.db.prepare(sql); }
  close() { return this.db.close(); }
}

test('strike target resolves to the Discord account from its approved application UUID', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-strike-link-'));
  const databasePath = path.join(directory, 'kind-smp.db');
  const appDb = new DatabaseAdapter(databasePath);
  appDb.exec(`CREATE TABLE applications (uuid TEXT, user_id TEXT NOT NULL, state TEXT NOT NULL, decided INTEGER);`);
  appDb.prepare('INSERT INTO applications VALUES (?, ?, ?, ?)').run('uuid-a', 'discord-ready', 'ready', 100);
  appDb.prepare('INSERT INTO applications VALUES (?, ?, ?, ?)').run('uuid-b', 'discord-old', 'superseded', 90);
  appDb.prepare('INSERT INTO applications VALUES (?, ?, ?, ?)').run('uuid-b', 'discord-current', 'ready', 110);
  appDb.prepare('INSERT INTO applications VALUES (?, ?, ?, ?)').run('uuid-pending', 'discord-pending', 'pending', null);
  appDb.close();

  const lookup = createApplicationDiscordLookup({ databasePath, DatabaseClass: DatabaseAdapter });
  t.after(() => { lookup.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(lookup('uuid-a'), 'discord-ready');
  assert.equal(lookup('uuid-b'), 'discord-current');
  assert.equal(lookup('uuid-pending'), null);
  assert.equal(lookup('unknown'), null);
});

test('missing or incompatible application database does not break strike handling', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-strike-link-'));
  const databasePath = path.join(directory, 'missing.db');
  const lookup = createApplicationDiscordLookup({ databasePath, DatabaseClass: DatabaseAdapter });
  t.after(() => { lookup.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(lookup('uuid-a'), null);
  const db = new DatabaseAdapter(databasePath);
  db.exec('CREATE TABLE unrelated (value TEXT)');
  db.close();
  assert.equal(lookup('uuid-a'), null);
});
