const KIND_SMP_GENERAL_STAFF_ROLE_ID = '1555726622982668408';

function strikeStaffRoleIds({ ownerRoleId, seniorStaffRoleId, generalStaffRoleId } = {}) {
  return [...new Set([
    ownerRoleId,
    seniorStaffRoleId,
    generalStaffRoleId,
    KIND_SMP_GENERAL_STAFF_ROLE_ID,
  ].map(id => String(id || '').trim()).filter(Boolean))];
}

function canManageStrikes(interaction, { guildId, roleIds = [] } = {}) {
  if (!interaction || interaction.guildId !== guildId) return false;
  const roles = interaction.member?.roles?.cache;
  return roleIds.some(roleId => roles?.has(roleId));
}

module.exports = { KIND_SMP_GENERAL_STAFF_ROLE_ID, strikeStaffRoleIds, canManageStrikes };
