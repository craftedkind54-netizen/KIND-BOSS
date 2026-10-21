'use strict';

function formatDuration(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && !minutes) return `${hours}h`;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function progressBar(current, total, width = 12) {
  const safeTotal = Math.max(1, Number(total) || 0);
  const fraction = Math.max(0, Math.min(1, (Number(current) || 0) / safeTotal));
  const filled = Math.round(fraction * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}

function buildActiveGoalPanel(goal) {
  const enoughPlayers = goal.sampleFresh && goal.onlinePlayers >= goal.targetPlayers;
  const online = goal.sampleFresh ? `${goal.onlinePlayers} / ${goal.targetPlayers}` : `— / ${goal.targetPlayers}`;
  const onlineStatus = goal.sampleFresh
    ? `**${online} players**\n${enoughPlayers ? '✅ Player target reached' : `Need ${Math.max(0, goal.targetPlayers - goal.onlinePlayers)} more players`}`
    : `**${online} players**\nWaiting for live tab-list count`;
  const todayStatus = `**${formatDuration(goal.secondsToday)} / ${formatDuration(goal.requiredSeconds)}**\n${progressBar(goal.secondsToday, goal.requiredSeconds)}\n${goal.dayQualified ? '✅ Today complete' : enoughPlayers ? '🟢 Timer is counting' : '⏸ Timer starts when the player target is reached'}`;
  const streakStatus = `**${goal.streak} / 7 days**\n${progressBar(goal.streak, 7)}\n${goal.streak >= 7 ? '✅ Weekly goal complete' : 'Complete the daily timer 7 days in a row'}`;

  return {
    title: '🏆 ACTIVE PLAYER GOAL',
    description: `Keep **${goal.targetPlayers} players** on the Minecraft tab list together for **${formatDuration(goal.requiredSeconds)} each day**. Complete it **7 days in a row**.\nThe tracker runs 24/7; today's timer only counts while the player target is met.`,
    fields: [
      { name: '👥 ACTIVE GOAL', value: onlineStatus, inline: true },
      { name: '⏱ TIMER', value: todayStatus, inline: true },
      { name: '🔥 WEEKLY STREAK', value: streakStatus, inline: true },
      { name: '🎁 PRIZE', value: goal.prize || 'No prize has been set yet.', inline: false }
    ],
    footer: `Timezone: ${goal.timezone}`
  };
}

module.exports = { buildActiveGoalPanel, formatDuration, progressBar };
