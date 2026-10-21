'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildActiveGoalPanel } = require('../src/activeGoalPresentation');

const goal = {
  targetPlayers: 10,
  requiredSeconds: 7200,
  secondsToday: 1800,
  streak: 3,
  sampleFresh: true,
  onlinePlayers: 5,
  averageOnlinePlayers: 4.5,
  averageCoverageSeconds: 48 * 60 * 60,
  prize: 'Lava casting rule will be removed',
  timezone: 'Pacific/Honolulu'
};

test('renders the clean text-only live goal panel without an image', () => {
  const panel = buildActiveGoalPanel(goal);
  const content = `${panel.title}\n${panel.description}\n${panel.fields.map(field => `${field.name}\n${field.value}`).join('\n')}\n${panel.footer}`;
  assert.match(content, /10 players/);
  assert.match(content, /5 \/ 10 players/);
  assert.match(content, /30m \/ 2h/);
  assert.match(content, /Need 5 more players/);
  assert.match(content, /timer only counts while the player target is met/);
  assert.match(content, /3 \/ 7 days/);
  assert.match(content, /Lava casting rule will be removed/);
  assert.match(content, /ACTIVE PLAYER GOAL/);
  assert.match(content, /WEEKLY STREAK/);
  assert.doesNotMatch(content, /attachment:|\.png|Border expands by 5k|Past 7-day average/);
});

test('a changed target and prize appear in the next text panel', () => {
  const panel = buildActiveGoalPanel({ ...goal, targetPlayers: 15, prize: 'Custom event prize' });
  const content = JSON.stringify(panel);
  assert.match(content, /15 players/);
  assert.match(content, /Custom event prize/);
  assert.doesNotMatch(content, /Lava casting rule will be removed/);
});

test('shows waiting state when the Minecraft tab-list sample is stale', () => {
  const panel = buildActiveGoalPanel({ ...goal, sampleFresh: false });
  assert.match(panel.fields.find(field => field.name === '👥 ACTIVE GOAL').value, /Waiting for live tab-list count/);
});

test('clearly shows when the player target is met and today is complete', () => {
  const panel = buildActiveGoalPanel({ ...goal, onlinePlayers: 10, dayQualified: true });
  assert.match(panel.fields.find(field => field.name === '👥 ACTIVE GOAL').value, /Player target reached/);
  assert.match(panel.fields.find(field => field.name === '⏱ TIMER').value, /Today complete/);
});
