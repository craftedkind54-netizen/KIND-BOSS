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

test('renders the configured player target over the old baked-in target', () => {
  const defaultGoal = decodeRgbPng(createActiveGoalCard(sampleGoal));
  const updatedGoal = decodeRgbPng(createActiveGoalCard({ ...sampleGoal, targetPlayers: 10 }));
  let changed = 0;
  for (let y = 0; y < defaultGoal.height; y++) for (let x = 0; x < defaultGoal.width; x++) {
    const offset = (y * defaultGoal.width + x) * 3;
    const differs = defaultGoal.pixels[offset] !== updatedGoal.pixels[offset]
      || defaultGoal.pixels[offset + 1] !== updatedGoal.pixels[offset + 1]
      || defaultGoal.pixels[offset + 2] !== updatedGoal.pixels[offset + 2];
    if (!differs) continue;
    changed++;
    assert.ok(x >= 251 && x < 329 && y >= 306 && y < 372, `unexpected change at ${x},${y}`);
  }
  assert.ok(changed > 0, 'expected the target number to change');
});

test('renders the configured prize over the old baked-in prize', () => {
  const oldPrize = decodeRgbPng(createActiveGoalCard(sampleGoal));
  const newPrize = decodeRgbPng(createActiveGoalCard({ ...sampleGoal, prize: 'Lava casting rule will be removed' }));
  let changed = 0;
  for (let y = 0; y < oldPrize.height; y++) for (let x = 0; x < oldPrize.width; x++) {
    const offset = (y * oldPrize.width + x) * 3;
    const differs = oldPrize.pixels[offset] !== newPrize.pixels[offset]
      || oldPrize.pixels[offset + 1] !== newPrize.pixels[offset + 1]
      || oldPrize.pixels[offset + 2] !== newPrize.pixels[offset + 2];
    if (!differs) continue;
    changed++;
    assert.ok(x >= 399 && x < 1517 && y >= 772 && y < 842, `unexpected change at ${x},${y}`);
  }
  assert.ok(changed > 0, 'expected the prize text to change');
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

test('shows daily timer and weekly streak progress only in their progress panels', () => {
  const early = decodeRgbPng(createActiveGoalCard({ ...sampleGoal, onlinePlayers: 6, sampleFresh: true }));
  const progressed = decodeRgbPng(createActiveGoalCard({ ...sampleGoal, onlinePlayers: 6, sampleFresh: true, secondsToday: 3600, streak: 3 }));
  let changed = 0;
  for (let y = 0; y < early.height; y++) for (let x = 0; x < early.width; x++) {
    const offset = (y * early.width + x) * 3;
    const differs = early.pixels[offset] !== progressed.pixels[offset]
      || early.pixels[offset + 1] !== progressed.pixels[offset + 1]
      || early.pixels[offset + 2] !== progressed.pixels[offset + 2];
    if (!differs) continue;
    changed++;
    assert.ok(y >= 416 && y < 666 && x >= 654 && x < 1535, `unexpected change at ${x},${y}`);
  }
  assert.ok(changed > 0, 'expected the daily and weekly progress indicators to change');
});
