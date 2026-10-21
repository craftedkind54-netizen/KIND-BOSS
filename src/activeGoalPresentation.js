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
  const enoughPlayers = goal.sampleFresh && goal.onlinePlayers >= goal.targetPlayers;
  const online = goal.sampleFresh ? `${goal.onlinePlayers} / ${goal.targetPlayers} players` : null;
  const onlineStatus = goal.sampleFresh
    ? `**${online}**\n${enoughPlayers ? '✅ Target reached' : `Need ${goal.targetPlayers - goal.onlinePlayers} more to start the timer`}\n${progressBar(goal.onlinePlayers, goal.targetPlayers)}`
    : 'Waiting for live player count';
  const todayStatus = `**${formatDuration(goal.secondsToday)} / ${duration}**\n${progressBar(goal.secondsToday, goal.requiredSeconds)}\n${goal.dayQualified ? '✅ Daily goal complete' : enoughPlayers ? '🟢 Timer is counting' : goal.sampleFresh ? `⏸ Waiting for ${goal.targetPlayers} players online together` : 'Waiting for live player count'}`;
  const streakStatus = `**${goal.streak} / 7 days**\n${progressBar(goal.streak, 7)}`;
  const averageStatus = goal.averageOnlinePlayers == null
    ? 'Collecting samples'
    : `**${goal.averageOnlinePlayers.toFixed(1)} players**\n${formatDuration(goal.averageCoverageSeconds)} tracked`;

  return {
    title: '🏆 KIND SMP | WEEKLY PLAYER GOAL',
    description: `**Goal:** ${goal.targetPlayers} players online together for **${duration} each day**, for **7 days in a row**.\nThe tracker runs 24/7. Today's timer only counts while enough players are online.`,
    fields: [
      { name: '👥 Players online now', value: onlineStatus, inline: true },
      { name: '⏱ Today', value: todayStatus, inline: true },
      { name: '🔥 Weekly streak', value: streakStatus, inline: true },
      { name: '📊 Past 7-day average', value: averageStatus, inline: false },
      { name: '🎁 Prize', value: goal.prize || 'No prize has been set yet.', inline: false }
    ],
    footer: `Timezone: ${goal.timezone}`
  };
}

module.exports = { buildActiveGoalPanel, formatDuration, progressBar };
