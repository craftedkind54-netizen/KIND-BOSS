'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reversibleStrikeAmount } = require('../src/strikeAppealPolicy');

test('approved appeal removes only the originally applied amount', () => {
  assert.equal(reversibleStrikeAmount(12, 2), 2);
});

test('appeal does not make the current total negative after later corrections', () => {
  assert.equal(reversibleStrikeAmount(1, 3), 1);
  assert.equal(reversibleStrikeAmount(0, 3), 0);
});

test('appeal reversal rejects invalid strike totals', () => {
  assert.throws(() => reversibleStrikeAmount(-1, 1), TypeError);
  assert.throws(() => reversibleStrikeAmount(3, 0), TypeError);
});
