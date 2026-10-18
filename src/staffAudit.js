function createStaffCommandEmbed(EmbedBuilder, { username, uuid, command, reason }) {
  if (!username || !uuid || !command) throw new Error('username, uuid, and command are required');
  const cleanUuid = String(uuid).replace(/-/g, '');
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('Staff mode command')
    .addFields(
      { name: 'Staff member', value: String(username).slice(0, 256), inline: true },
      { name: 'Command', value: String(command).slice(0, 1024), inline: false },
      { name: 'Staff mode reason', value: String(reason || 'Not recorded').slice(0, 1024), inline: false }
    )
    .setThumbnail(`https://mc-heads.net/avatar/${cleanUuid}/64`)
    .setTimestamp();
}

module.exports = { createStaffCommandEmbed };
