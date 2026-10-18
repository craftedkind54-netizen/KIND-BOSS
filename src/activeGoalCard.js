'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Use the approved visual mockup itself so the Discord board matches it
// exactly. Live counts and progress are kept in the message text alongside it.
const REFERENCE_CARD = fs.readFileSync(path.join(__dirname, 'assets', 'active-goal-reference.png'));

function createActiveGoalCard() {
  return Buffer.from(REFERENCE_CARD);
}

module.exports = { createActiveGoalCard };
