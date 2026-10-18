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

test('renders the goal board as a 1600 by 900 PNG', () => {
  const png = createActiveGoalCard(sampleGoal);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1600);
  assert.equal(png.readUInt32BE(20), 900);
});

test('updates the rendered card when live goal progress changes', () => {
  const before = createActiveGoalCard(sampleGoal);
  const after = createActiveGoalCard({ ...sampleGoal, onlinePlayers: 15, secondsToday: 3600, streak: 3, sampleFresh: true });
  assert.notDeepEqual(before, after);
});
