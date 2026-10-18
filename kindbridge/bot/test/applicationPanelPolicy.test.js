import test from 'node:test';
import assert from 'node:assert/strict';
import { isOwnedApplicationPanel } from '../src/applicationPanelPolicy.js';

test('republishes the application panel when its stored message belongs to the retired bot', () => {
  assert.equal(isOwnedApplicationPanel({ author: { id: 'kind-applications' } }, 'kind-boss'), false);
  assert.equal(isOwnedApplicationPanel({ author: { id: 'kind-boss' } }, 'kind-boss'), true);
  assert.equal(isOwnedApplicationPanel(null, 'kind-boss'), false);
});
