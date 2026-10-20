const test = require('node:test');
const assert = require('node:assert/strict');
const { KIND_SMP_GENERAL_STAFF_ROLE_ID, strikeStaffRoleIds, canManageStrikes } = require('../src/strikeStaffAccess');

test('General Staff can submit strike proposals even when the configured role ID is stale', () => {
  const roleIds = strikeStaffRoleIds({
    ownerRoleId: 'owner-role',
    seniorStaffRoleId: 'senior-role',
    generalStaffRoleId: 'stale-general-staff-role',
  });
  const interaction = {
    guildId: 'kind-smp',
    member: { roles: { cache: new Map([[KIND_SMP_GENERAL_STAFF_ROLE_ID, {}]]) } },
  };

  assert.ok(roleIds.includes(KIND_SMP_GENERAL_STAFF_ROLE_ID));
  assert.equal(canManageStrikes(interaction, { guildId: 'kind-smp', roleIds }), true);
});

test('strike access still rejects unrelated roles and other servers', () => {
  const roleIds = strikeStaffRoleIds({ generalStaffRoleId: 'stale-general-staff-role' });
  const member = { roles: { cache: new Map([['member-role', {}]]) } };

  assert.equal(canManageStrikes({ guildId: 'kind-smp', member }, { guildId: 'kind-smp', roleIds }), false);
  member.roles.cache.set(KIND_SMP_GENERAL_STAFF_ROLE_ID, {});
  assert.equal(canManageStrikes({ guildId: 'other-server', member }, { guildId: 'kind-smp', roleIds }), false);
});
