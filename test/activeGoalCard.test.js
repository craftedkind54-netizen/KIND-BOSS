'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createActiveGoalCard } = require('../src/activeGoalCard');

const sampleGoal = {
  targetPlayers: 15,
  requiredSeconds: 7200,
  secondsToday: 0,
  streak: 0,
  sampleFresh: false,
  onlinePlayers: 0,
  dayQualified: false,
  prize: 'Border expands by 5k',
  timezone: 'Pacific/Honolulu'
};

test('uses the generated goal board artwork as the exact Discord card', () => {
  const png = createActiveGoalCard(sampleGoal);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1605);
  assert.equal(png.readUInt32BE(20), 980);
});

test('keeps the artwork stable while live goal progress is shown in message text', () => {
  const before = createActiveGoalCard(sampleGoal);
  const after = createActiveGoalCard({ ...sampleGoal, onlinePlayers: 15, secondsToday: 3600, streak: 3, sampleFresh: true });
  assert.deepEqual(before, after);
});
