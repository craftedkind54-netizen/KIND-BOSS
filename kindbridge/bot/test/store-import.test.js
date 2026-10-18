import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';

test('imports Kind Bridge rows into the combined store once and preserves existing rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kindbridge-import-'));
  const source = new Store(join(dir, 'source.db'));
  const target = new Store(join(dir, 'target.db'));
  try {
    source.run(`INSERT INTO applications(id,user_id,edition,username,answers,state,created) VALUES(?,?,?,?,?,?,?)`, 'source-app', 'discord-user', 'java', 'SourcePlayer', '{}', 'pending', 10);
    source.set('sourceSetting', 'kept');
    target.run(`INSERT INTO applications(id,user_id,edition,username,answers,state,created) VALUES(?,?,?,?,?,?,?)`, 'target-app', 'other-user', 'java', 'TargetPlayer', '{}', 'pending', 20);

    const imported = target.importFrom(join(dir, 'source.db'));

    assert.equal(target.one('SELECT username FROM applications WHERE id=?', 'source-app').username, 'SourcePlayer');
    assert.equal(target.one('SELECT username FROM applications WHERE id=?', 'target-app').username, 'TargetPlayer');
    assert.equal(target.get('sourceSetting'), 'kept');
    assert.equal(imported.applications, 1);
    assert.throws(() => target.importFrom(join(dir, 'source.db')), /already been imported/);
  } finally {
    source.close();
    target.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
