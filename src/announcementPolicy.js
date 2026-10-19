'use strict';

const POLL_ANSWER_MODAL_IDS = new Set(['poll_answers_1', 'poll_answers_2']);
const ANNOUNCEMENT_MODAL_IDS = new Set(['announcement_modal', 'poll_setup', 'event_modal', 'announcement_approval_reason']);
const APPROVAL_CONTENT_TYPES = new Set([
  'announcement', 'flash', 'poll',
  'announcement_event', 'announcement_poll', 'announcement_event_poll', 'event_poll',
]);

const ROLE_NAME_ALIASES = Object.freeze({
  generalStaff: new Set(['general staff', 'staff', 'head general staff']),
  seniorStaff: new Set(['senior staff', 'head senior staff']),
  owner: new Set(['owner']),
  coOwner: new Set(['co-owner', 'co owner', 'coowner']),
});

function normalizeRoleName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function hasAnnouncementRole(member, configuredRoleIds, roleNameAliases) {
  const roles = member?.roles?.cache;
  if (!roles) return false;
  if (configuredRoleIds.some(id => id && roles.has?.(id))) return true;
  if (typeof roles.values !== 'function') return false;
  return Array.from(roles.values()).some(role => roleNameAliases.has(normalizeRoleName(role?.name)));
}

function announcementApprovalRoleIds(member, { generalStaffRoleId, seniorStaffRoleId }) {
  const roleIds = [];
  if (hasAnnouncementRole(member, [generalStaffRoleId], ROLE_NAME_ALIASES.generalStaff)) roleIds.push('general-staff');
  if (hasAnnouncementRole(member, [seniorStaffRoleId], ROLE_NAME_ALIASES.seniorStaff)) roleIds.push('senior-staff');
  return roleIds;
}

function isAnnouncementStaff(member, roleIds) {
  return hasAnnouncementRole(member, [
    roleIds.owner,
    roleIds.coOwner,
    roleIds.seniorStaff,
    roleIds.generalStaff,
  ], new Set([
    ...ROLE_NAME_ALIASES.generalStaff,
    ...ROLE_NAME_ALIASES.seniorStaff,
    ...ROLE_NAME_ALIASES.owner,
    ...ROLE_NAME_ALIASES.coOwner,
  ]));
}

function isAnnouncementOwnerOrCoOwner(member, roleIds) {
  return hasAnnouncementRole(member, [roleIds.owner, roleIds.coOwner], new Set([
    ...ROLE_NAME_ALIASES.owner,
    ...ROLE_NAME_ALIASES.coOwner,
  ]));
}

function isAnnouncementModalId(id) {
  return ANNOUNCEMENT_MODAL_IDS.has(id) || POLL_ANSWER_MODAL_IDS.has(id);
}

function requiresAnnouncementApproval({ type, roleIds = [], owner = false }) {
  return !owner && APPROVAL_CONTENT_TYPES.has(type)
    && roleIds.some(id => id === 'general-staff' || id === 'senior-staff');
}

module.exports = {
  isAnnouncementModalId,
  requiresAnnouncementApproval,
  hasAnnouncementRole,
  announcementApprovalRoleIds,
  isAnnouncementStaff,
  isAnnouncementOwnerOrCoOwner,
  POLL_ANSWER_MODAL_IDS,
};
