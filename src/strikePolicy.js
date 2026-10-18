'use strict';

function punishmentFor(total) {
  if (!Number.isSafeInteger(total) || total < 0) throw new TypeError('Strike total must be a non-negative integer');
  if (total === 0) return null;
  if (total <= 3) return { type: 'jail', duration: '5m' };
  if (total <= 6) return { type: 'jail', duration: '10m' };
  if (total <= 9) return { type: 'jail', duration: '15m' };
  return { type: 'tempban', duration: ({ 10: '2d', 11: '4d', 12: '6d', 13: '10d12h', 14: '17d12h', 15: '30d' })[Math.min(total, 15)] };
}

function projectedTotal(current, action, amount) {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(amount) || amount < 1) throw new TypeError('Invalid strike total or amount');
  if (action === 'add') return current + amount;
  if (action === 'remove') return Math.max(0, current - amount);
  throw new TypeError('Action must be add or remove');
}

module.exports = { punishmentFor, projectedTotal };
