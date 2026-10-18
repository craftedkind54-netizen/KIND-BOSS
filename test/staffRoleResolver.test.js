'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStaffRole } = require('../src/staffRoleResolver');

function fakeGuild(roles) {
  const cache = new Map(roles.map(role => [role.id, role]));
  return {
    roles: {
      cache,
      async fetch(id) {
        if (id) {
          const role = cache.get(id);
          if (!role) throw new Error('Unknown role');
          return role;
        }
        return cache;
      }
    }
  };
}

test('uses the configured role when the configured ID exists', async () => {
  const configured = { id: 'configured', name: 'Staff' };
  const fallback = { id: 'fallback', name: 'General Staff' };
  const role = await resolveStaffRole(fakeGuild([configured, fallback]), 'general', 'configured');
  assert.equal(role, configured);
});

test('falls back to the server General Staff role name when its configured ID is stale', async () => {
  const staff = { id: 'staff', name: ' Staff  ' };
  const unrelated = { id: 'other', name: 'Senior Staff' };
  const role = await resolveStaffRole(fakeGuild([unrelated, staff]), 'general', 'deleted-role-id');
  assert.equal(role, staff);
});

test('can resolve the General Staff fallback when no role ID is configured', async () => {
  const staff = { id: 'staff', name: 'Staff' };
  const role = await resolveStaffRole(fakeGuild([staff]), 'general', undefined);
  assert.equal(role, staff);
});

test('does not guess a role for other ranks when their configured ID is missing', async () => {
  const role = await resolveStaffRole(fakeGuild([{ id: 'staff', name: 'Staff' }]), 'senior', 'deleted-role-id');
  assert.equal(role, null);
});
