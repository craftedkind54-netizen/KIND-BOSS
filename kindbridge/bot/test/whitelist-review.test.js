import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { submit, decide, lookupMinecraftAccount, returnFailedWhitelistsToReview, whitelistReport, whitelistAgain } from '../src/applications.js';

const form = (username, edition = 'java') => ({ edition, username, age: '18', rules: 'yes', heard: '', why: 'Build', youtube: '' });

test('Java name lookup: found, missing, and unknown on errors', async () => {
  assert.equal(await lookupMinecraftAccount('java', 'Notch', async () => ({ status: 200 })), 'found');
  assert.equal(await lookupMinecraftAccount('java', 'Nobody', async () => ({ status: 204 })), 'missing');
  assert.equal(await lookupMinecraftAccount('java', 'Nobody', async () => ({ status: 404 })), 'missing');
  assert.equal(await lookupMinecraftAccount('java', 'Busy', async () => ({ status: 429 })), 'unknown');
  assert.equal(await lookupMinecraftAccount('java', 'Down', async () => { throw new Error('offline'); }), 'unknown');
  assert.equal(await lookupMinecraftAccount('bedrock', 'Some Tag', async () => { throw new Error('not called'); }), 'unknown');
});

test('A failed whitelist goes back to staff review once, with the reason, and can be approved again', () => {
  const s = new Store(':memory:');
  const id = submit(s, 'u1', form('Typo_Name'), 0);
  decide(s, id, 'staff', true);
  s.run("UPDATE applications SET log_id='old' WHERE id=?", id);
  s.run("UPDATE jobs SET state='failed',error='Java Minecraft account not found' WHERE kind='whitelist'");
  assert.equal(returnFailedWhitelistsToReview(s), 1);
  const app = s.one('SELECT * FROM applications WHERE id=?', id);
  assert.equal(app.state, 'pending'); assert.equal(app.log_id, null);
  assert.match(s.get('whitelistFailure:' + id), /account not found/);
  assert.equal(returnFailedWhitelistsToReview(s), 0);
  decide(s, id, 'staff', true);
  assert.equal(s.one("SELECT state FROM jobs WHERE kind='whitelist'").state, 'queued');
});

test('Approved applications still waiting for the server are left alone', () => {
  const s = new Store(':memory:');
  const id = submit(s, 'u2', form('Waiting'), 0);
  decide(s, id, 'staff', true);
  assert.equal(returnFailedWhitelistsToReview(s), 0);
  assert.equal(s.one('SELECT state FROM applications WHERE id=?', id).state, 'approved');
});

test('Whitelist check reports each state by Minecraft name or Discord ID', () => {
  const s = new Store(':memory:');
  assert.match(whitelistReport(s, 'Ghost'), /No application found/);
  const id = submit(s, '123456789012345678', form('Steve_1'), 0);
  assert.match(whitelistReport(s, 'steve_1'), /Waiting for staff review/);
  decide(s, id, 'staff', true);
  assert.match(whitelistReport(s, '<@123456789012345678>'), /waiting for the Minecraft server/);
  s.run("UPDATE jobs SET state='failed',error='Java Minecraft account not found'");
  assert.match(whitelistReport(s, 'Steve_1'), /Whitelist failed: Java Minecraft account not found/);
  s.run("UPDATE applications SET state='ready'");
  assert.match(whitelistReport(s, 'Steve_1'), /✅ Whitelisted/);
  const b = submit(s, 'u9', form('Cool Tag', 'bedrock'), 0);
  assert.match(whitelistReport(s, '.Cool Tag'), /Cool Tag\*\* \(bedrock\)/); assert.ok(b);
});

test('Whitelist again re-sends the job for an accepted member without changing their application', () => {
  const s = new Store(':memory:');
  const id = submit(s, 'u5', form('Again Tag', 'bedrock'), 0);
  assert.throws(() => whitelistAgain(s, id), /Only approved or whitelisted/);
  decide(s, id, 'staff', true);
  let job = s.lease(); assert.ok(s.ack(job.id, job.lease, true, { uuid: '00000000-0000-0000-0009-01aaaaaaaaaa' }));
  assert.equal(s.one('SELECT state FROM applications WHERE id=?', id).state, 'ready');
  whitelistAgain(s, id, 5000); whitelistAgain(s, id, 6000);
  assert.equal(s.one("SELECT count(*) n FROM jobs WHERE state='queued'").n, 1);
  job = s.lease(); assert.equal((typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload).redo, true);
  assert.ok(s.ack(job.id, job.lease, true, { uuid: '00000000-0000-0000-0009-01aaaaaaaaaa' }, '', 7000));
  assert.equal(s.one('SELECT state FROM applications WHERE id=?', id).state, 'ready');
  assert.match(whitelistReport(s, 'Again Tag'), /Re-sent/);
});
