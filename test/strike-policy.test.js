const test = require('node:test');
const assert = require('node:assert/strict');
const { punishmentFor, projectedTotal } = require('../src/strikePolicy');

test('cumulative strike total selects the agreed jail and temp-ban schedule', () => {
  assert.equal(punishmentFor(0), null);
  assert.deepEqual(punishmentFor(1), { type: 'jail', duration: '5m' });
  assert.deepEqual(punishmentFor(3), { type: 'jail', duration: '5m' });
  assert.deepEqual(punishmentFor(4), { type: 'jail', duration: '10m' });
  assert.deepEqual(punishmentFor(7), { type: 'jail', duration: '15m' });
  assert.deepEqual(punishmentFor(9), { type: 'jail', duration: '15m' });
  assert.deepEqual(punishmentFor(10), { type: 'tempban', duration: '2d' });
  assert.deepEqual(punishmentFor(11), { type: 'tempban', duration: '4d' });
  assert.deepEqual(punishmentFor(12), { type: 'tempban', duration: '6d' });
  assert.deepEqual(punishmentFor(13), { type: 'tempban', duration: '10d12h' });
  assert.deepEqual(punishmentFor(14), { type: 'tempban', duration: '17d12h' });
  assert.deepEqual(punishmentFor(15), { type: 'tempban', duration: '30d' });
  assert.deepEqual(punishmentFor(20), { type: 'tempban', duration: '30d' });
});

test('punishment is based on the total after the proposed change', () => {
  const next = projectedTotal(2, 'add', 3);
  assert.equal(next, 5);
  assert.deepEqual(punishmentFor(next), { type: 'jail', duration: '10m' });
  assert.equal(projectedTotal(2, 'remove', 3), 0);
});

test('rejects invalid totals and actions', () => {
  assert.throws(() => punishmentFor(-1), TypeError);
  assert.throws(() => projectedTotal(2, 'multiply', 1), TypeError);
});
