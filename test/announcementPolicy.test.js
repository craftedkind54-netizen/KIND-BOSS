'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAnnouncementModalId,
  requiresAnnouncementApproval,
  announcementApprovalRoleIds,
  isAnnouncementStaff,
  isAnnouncementOwnerOrCoOwner,
} = require('../src/announcementPolicy');

function memberWithRoles(...roles) {
  return { roles: { cache: new Map(roles.map((role, index) => [role.id || String(index), role])) } };
}

test('acknowledges both poll answer modal pages', () => {
  assert.equal(isAnnouncementModalId('poll_answers_1'), true);
  assert.equal(isAnnouncementModalId('poll_answers_2'), true);
  assert.equal(isAnnouncementModalId('poll_answer_modal'), false);
});

test('requires owner review for polls and announcements made by General or Senior Staff', () => {
  assert.equal(requiresAnnouncementApproval({ type: 'announcement', roleIds: ['general-staff'] }), true);
  assert.equal(requiresAnnouncementApproval({ type: 'flash', roleIds: ['senior-staff'] }), true);
  assert.equal(requiresAnnouncementApproval({ type: 'poll', roleIds: ['general-staff'] }), true);
  assert.equal(requiresAnnouncementApproval({ type: 'announcement_poll', roleIds: ['general-staff'] }), true);
  assert.equal(requiresAnnouncementApproval({ type: 'event_poll', roleIds: ['senior-staff'] }), true);
});

test('does not route owner posts or event-only drafts through announcement approval', () => {
  assert.equal(requiresAnnouncementApproval({ type: 'announcement', roleIds: ['general-staff'], owner: true }), false);
  assert.equal(requiresAnnouncementApproval({ type: 'event', roleIds: ['general-staff'] }), false);
  assert.equal(requiresAnnouncementApproval({ type: 'announcement', roleIds: ['member'] }), false);
});

test('recognizes General Staff by its server role name when the configured role ID is stale', () => {
  const member = memberWithRoles({ id: 'actual-staff-id', name: ' Staff ' });
  const configured = {
    generalStaffRoleId: 'stale-general-staff-id',
    seniorStaffRoleId: 'stale-senior-staff-id',
  };

  assert.equal(isAnnouncementStaff(member, {
    owner: 'owner-id', coOwner: 'co-owner-id', seniorStaff: configured.seniorStaffRoleId,
    generalStaff: configured.generalStaffRoleId,
  }), true);
  assert.deepEqual(announcementApprovalRoleIds(member, configured), ['general-staff']);
});

test('recognizes Senior Staff by its server role name and still requires approval', () => {
  const member = memberWithRoles({ id: 'actual-senior-id', name: 'Senior Staff' });
  const roleIds = { generalStaffRoleId: 'general-id', seniorStaffRoleId: 'stale-senior-id' };

  assert.deepEqual(announcementApprovalRoleIds(member, roleIds), ['senior-staff']);
  assert.equal(requiresAnnouncementApproval({ type: 'flash', roleIds: announcementApprovalRoleIds(member, roleIds) }), true);
});

test('recognizes owner aliases so owner posts bypass the staff approval queue', () => {
  assert.equal(isAnnouncementOwnerOrCoOwner(memberWithRoles({ id: 'owner', name: 'Owner' }), { owner: 'stale', coOwner: 'co' }), true);
  assert.equal(isAnnouncementOwnerOrCoOwner(memberWithRoles({ id: 'co', name: 'Co-Owner' }), { owner: 'owner', coOwner: 'stale' }), true);
});

test('does not grant announcement tools to similarly named unrelated roles', () => {
  const member = memberWithRoles({ id: 'other', name: 'Staff Helper' });
  assert.equal(isAnnouncementStaff(member, { owner: 'owner', coOwner: 'co', seniorStaff: 'senior', generalStaff: 'general' }), false);
  assert.deepEqual(announcementApprovalRoleIds(member, { generalStaffRoleId: 'general', seniorStaffRoleId: 'senior' }), []);
});
