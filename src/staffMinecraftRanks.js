'use strict';

// Keys here are the actual rank identifiers accepted by CraftedCore's /rank set.
const MINECRAFT_RANKS = Object.freeze({
  general: 'general_staff',
  head_general: 'head_staff_2nd',
  senior: 'senior_staff',
  head_senior: 'head_staff',
  co_owner: 'co_owner',
  owner: 'owner'
});

function minecraftRankForTarget(targetRank) {
  return MINECRAFT_RANKS[targetRank] || null;
}

module.exports = { MINECRAFT_RANKS, minecraftRankForTarget };
