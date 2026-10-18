'use strict';

const POLL_ANSWER_MODAL_IDS = new Set(['poll_answers_1', 'poll_answers_2']);
const ANNOUNCEMENT_MODAL_IDS = new Set(['announcement_modal', 'poll_setup', 'event_modal', 'announcement_approval_reason']);
const APPROVAL_CONTENT_TYPES = new Set([
  'announcement', 'flash', 'poll',
  'announcement_event', 'announcement_poll', 'announcement_event_poll', 'event_poll',
]);

function isAnnouncementModalId(id) {
  return ANNOUNCEMENT_MODAL_IDS.has(id) || POLL_ANSWER_MODAL_IDS.has(id);
}

function requiresAnnouncementApproval({ type, roleIds = [], owner = false }) {
  return !owner && APPROVAL_CONTENT_TYPES.has(type)
    && roleIds.some(id => id === 'general-staff' || id === 'senior-staff');
}

module.exports = { isAnnouncementModalId, requiresAnnouncementApproval, POLL_ANSWER_MODAL_IDS };
