'use strict';

function reversibleStrikeAmount(currentTotal, originallyApplied) {
  if (!Number.isSafeInteger(currentTotal) || currentTotal < 0) {
    throw new TypeError('Current strike total must be a non-negative whole number');
  }
  if (!Number.isSafeInteger(originallyApplied) || originallyApplied < 1) {
    throw new TypeError('Originally applied strikes must be a positive whole number');
  }
  return Math.min(currentTotal, originallyApplied);
}

module.exports = { reversibleStrikeAmount };
