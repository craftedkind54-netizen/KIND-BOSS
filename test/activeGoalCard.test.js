'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createActiveGoalCard, decodeRgbPng } = require('../src/activeGoalCard');

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

test('keeps the artwork unchanged when only the seven-day average changes', () => {
  const withoutAverage = createActiveGoalCard({ ...sampleGoal, onlinePlayers: 5, sampleFresh: true });
  const withAverage = createActiveGoalCard({ ...sampleGoal, onlinePlayers: 5, sampleFresh: true, averageOnlinePlayers: 4.6 });
  assert.deepEqual(withAverage, withoutAverage);
});

test('changes only the Players Online panel when the live count changes', () => {
  const fiveOnline = decodeRgbPng(createActiveGoalCard({ ...sampleGoal, onlinePlayers: 5, sampleFresh: true }));
  const sixOnline = decodeRgbPng(createActiveGoalCard({ ...sampleGoal, onlinePlayers: 6, sampleFresh: true }));
  for (let y = 0; y < fiveOnline.height; y++) {
    const rowStart = y * fiveOnline.width * 3;
    const panelStart = y >= 416 && y < 666 ? 82 * 3 : 0;
    const panelEnd = y >= 416 && y < 666 ? 637 * 3 : fiveOnline.width * 3;
    assert.deepEqual(fiveOnline.pixels.subarray(rowStart, rowStart + panelStart), sixOnline.pixels.subarray(rowStart, rowStart + panelStart));
    assert.deepEqual(fiveOnline.pixels.subarray(rowStart + panelEnd, rowStart + fiveOnline.width * 3), sixOnline.pixels.subarray(rowStart + panelEnd, rowStart + fiveOnline.width * 3));
  }
});
