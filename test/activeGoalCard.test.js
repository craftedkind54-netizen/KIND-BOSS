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

test('renders a valid goal board PNG with the approved dimensions', () => {
  const png = createActiveGoalCard(sampleGoal);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1605);
  assert.equal(png.readUInt32BE(20), 980);
});

test('renders the current online count into the image instead of leaving the placeholder', () => {
  const waiting = createActiveGoalCard(sampleGoal);
  const fourOnline = createActiveGoalCard({ ...sampleGoal, onlinePlayers: 4, sampleFresh: true });
  const targetReached = createActiveGoalCard({ ...sampleGoal, onlinePlayers: 15, sampleFresh: true });
  assert.notDeepEqual(fourOnline, waiting);
  assert.notDeepEqual(targetReached, fourOnline);
});

test('renders the rolling seven-day average in the players tile', () => {
  const withoutAverage = createActiveGoalCard({ ...sampleGoal, onlinePlayers: 5, sampleFresh: true });
  const withAverage = createActiveGoalCard({ ...sampleGoal, onlinePlayers: 5, sampleFresh: true, averageOnlinePlayers: 4.6 });
  assert.notDeepEqual(withAverage, withoutAverage);
});
