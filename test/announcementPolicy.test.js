'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAnnouncementModalId, requiresAnnouncementApproval } = require('../src/announcementPolicy');

test('acknowledges both poll answer modal pages', () => {
  assert.equal(isAnnouncementModalId('poll_answers_1'), true);
  assert.equal(isAnnouncementModalId('poll_answers_2'), true);
  assert.equal(isAnnouncementModalId('poll_answer_modal'), false);
});

test('requires owner review for announcements made by General or Senior Staff', () => {
  assert.equal(requiresAnnouncementApproval({ type: 'announcement', roleIds: ['general-staff'] }), true);
  assert.equal(requiresAnnouncementApproval({ type: 'flash', roleIds: ['senior-staff'] }), true);
  assert.equal(requiresAnnouncementApproval({ type: 'announcement_poll', roleIds: ['general-staff'] }), true);
});

test('does not route owner posts or poll-only drafts through announcement approval', () => {
  assert.equal(requiresAnnouncementApproval({ type: 'announcement', roleIds: ['general-staff'], owner: true }), false);
  assert.equal(requiresAnnouncementApproval({ type: 'poll', roleIds: ['general-staff'] }), false);
  assert.equal(requiresAnnouncementApproval({ type: 'announcement', roleIds: ['member'] }), false);
});
