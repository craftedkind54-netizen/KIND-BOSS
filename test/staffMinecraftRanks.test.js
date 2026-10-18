'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { minecraftRankForTarget } = require('../src/staffMinecraftRanks');

test('staff application targets map to CraftedCore rank identifiers', () => {
  assert.deepEqual([
    minecraftRankForTarget('general'),
    minecraftRankForTarget('head_general'),
    minecraftRankForTarget('senior'),
    minecraftRankForTarget('head_senior'),
    minecraftRankForTarget('co_owner'),
    minecraftRankForTarget('owner')
  ], ['general_staff','head_staff_2nd','senior_staff','head_staff','co_owner','owner']);
  assert.equal(minecraftRankForTarget('unknown'), null);
});
