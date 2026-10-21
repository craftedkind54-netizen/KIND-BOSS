'use strict';

function formatDuration(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function progressBar(current, total, width = 12) {
  const safeTotal = Math.max(1, Number(total) || 0);
  const fraction = Math.max(0, Math.min(1, (Number(current) || 0) / safeTotal));
  const filled = Math.round(fraction * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}

function buildActiveGoalPanel(goal) {
  const duration = formatDuration(goal.requiredSeconds);
  const online = goal.sampleFresh ? `${goal.onlinePlayers}/${goal.targetPlayers}` : `—/${goal.targetPlayers}`;
  const onlineStatus = goal.sampleFresh
    ? `**${online} players**\n${progressBar(goal.onlinePlayers, goal.targetPlayers)}`
    : `Waiting for Minecraft server data\n${progressBar(0, goal.targetPlayers)}`;
  const today = `${formatDuration(goal.secondsToday)} / ${duration}`;
  const todayStatus = `**${today}**\n${progressBar(goal.secondsToday, goal.requiredSeconds)}`;
  const streakStatus = `**${goal.streak} / 7 days**\n${progressBar(goal.streak, 7)}`;
  const averageStatus = goal.averageOnlinePlayers == null
    ? 'Collecting samples'
    : `**${goal.averageOnlinePlayers.toFixed(1)} players**\n${formatDuration(goal.averageCoverageSeconds)} tracked`;

  return {
    title: '🏆 KIND SMP · ACTIVE PLAYER GOAL',
    description: `Keep at least **${goal.targetPlayers} players** on the tab list at the same time for **${duration} each day**. Reach the goal **7 days in a row**. Tracking runs **24/7**.`,
    fields: [
      { name: '👥 Players online now', value: onlineStatus, inline: true },
      { name: '⏱ Today', value: todayStatus, inline: true },
      { name: '🔥 Weekly streak', value: streakStatus, inline: true },
      { name: '📊 Past 7-day average', value: averageStatus, inline: true },
      { name: '🎁 Prize', value: goal.prize || 'No prize has been set yet.', inline: false }
    ],
    footer: `Timer counts only while the player target is met · ${goal.timezone}`
  };
}

module.exports = { buildActiveGoalPanel, formatDuration, progressBar };
