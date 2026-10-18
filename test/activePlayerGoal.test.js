'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createActivePlayerGoal } = require('../src/activePlayerGoal');

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  let now = Date.parse('2026-10-18T00:00:00Z');
  const goal = createActivePlayerGoal(db, { timezone: 'UTC', now: () => now });
  return { db, goal, setNow: value => { now = value; } };
}

test('counts consecutive qualified days and displays the owner-defined prize without applying it', () => {
  const { db, goal, setNow } = setup();
  goal.setGoal(15, 1, 'Owner will expand the border by 5,000 blocks');
  for (let day = 0; day < 7; day++) {
    const start = Date.parse(`2026-10-${String(18 + day).padStart(2, '0')}T00:00:00Z`);
    setNow(start); goal.recordSample(15, start);
    setNow(start + 30_000); goal.recordSample(15, start + 30_000);
    setNow(start + 60_000); goal.recordSample(15, start + 60_000);
  }
  assert.equal(goal.snapshot().streak, 7);
  assert.equal(goal.snapshot().dayQualified, true);
  assert.equal(goal.snapshot().prize, 'Owner will expand the border by 5,000 blocks');
  db.close();
});

test('daily timer only counts intervals where both tab-list samples meet the target', () => {
  const { db, goal, setNow } = setup();
  goal.setGoal(5, 2);
  const start = Date.parse('2026-10-18T00:00:00Z');
  setNow(start); goal.recordSample(5, start);
  setNow(start + 30_000); goal.recordSample(5, start + 30_000);
  setNow(start + 60_000); goal.recordSample(4, start + 60_000);
  assert.equal(goal.snapshot().secondsToday, 30);
  setNow(start + 90_000); goal.recordSample(5, start + 90_000);
  assert.equal(goal.snapshot().secondsToday, 30);
  setNow(start + 120_000); goal.recordSample(5, start + 120_000);
  assert.equal(goal.snapshot().secondsToday, 60);
  goal.markOffline(start + 130_000);
  assert.equal(goal.snapshot().secondsToday, 60);
  db.close();
});

test('editing only the prize keeps the active timer', () => {
  const { db, goal, setNow } = setup();
  goal.setGoal(5, 2, 'First prize');
  const start = Date.parse('2026-10-18T00:00:00Z');
  setNow(start); goal.recordSample(5, start);
  setNow(start + 30_000); goal.recordSample(5, start + 30_000);
  goal.setGoal(5, 2, 'Updated prize');
  setNow(start + 60_000); goal.recordSample(5, start + 60_000);
  assert.equal(goal.snapshot().secondsToday, 60);
  assert.equal(goal.snapshot().prize, 'Updated prize');
  db.close();
});
