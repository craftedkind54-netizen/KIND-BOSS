'use strict';

const COLORS = Object.freeze({ idle: 0x6b7280, counting: 0xf2c14e, complete: 0x22c55e, weekly: 0x35c5b5 });

function formatDuration(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && !minutes) return `${hours}h`;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Emoji squares render at the same size on every Discord client (the old
// ▰▱ glyphs showed as empty boxes on some fonts).
function progressBar(current, total, width = 10, fill = '🟩') {
  const safeTotal = Math.max(1, Number(total) || 0);
  const fraction = Math.max(0, Math.min(1, (Number(current) || 0) / safeTotal));
  const filled = Math.round(fraction * width);
  return `${fill.repeat(filled)}${'⬛'.repeat(width - filled)} ${Math.round(fraction * 100)}%`;
}

function streakDots(history) {
  if (!Array.isArray(history) || !history.length) return '';
  // Missed days are a quiet grey square so a new streak doesn't open on a wall of red X's.
  return history.map(day => day === true ? '✅' : day === false ? '⬛' : '⏳').join('');
}

const HEAT = ['⬛', '🟦', '🟪', '🟨'];
function heatLevel(value, max) {
  if (value == null || value <= 0 || max <= 0) return HEAT[0];
  const ratio = value / max;
  return ratio >= 0.75 ? HEAT[3] : ratio >= 0.4 ? HEAT[2] : HEAT[1];
}

function hourLabel(hour) {
  const suffix = hour < 12 ? 'a' : 'p';
  const h = hour % 12 || 12;
  return `${String(h).padStart(2, ' ')}${suffix}`;
}

function buildHeatmap(heatmap) {
  const cells = heatmap?.cells;
  if (!Array.isArray(cells) || !cells.some(row => row.some(value => value != null))) return null;
  const max = Math.max(...cells.flat().filter(value => value != null));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // One row per day: text labels sit to the left of the squares, so nothing
  // has to line up above emoji (letters and emoji have different widths).
  const lines = [`\`   \` 12a ➜ 9p · ${heatmap.bucketHours}h blocks`];
  cells.forEach((row, d) => lines.push(`\`${days[d].slice(0, 3)}\` ${row.map(value => heatLevel(value, max)).join('')}`));
  let peak = null;
  cells.forEach((row, d) => row.forEach((value, b) => { if (value != null && (!peak || value > peak.value)) peak = { value, d, b }; }));
  if (peak) {
    const start = peak.b * heatmap.bucketHours;
    lines.push(`🎯 Best time to play: **${days[peak.d]} ${hourLabel(start).trim()}–${hourLabel((start + heatmap.bucketHours) % 24).trim()}** (avg ${peak.value.toFixed(1)} online)`);
  }
  lines.push('-# ⬛ none 🟦 low 🟪 busy 🟨 peak · last 28 days');
  return lines.join('\n');
}

function buildActiveGoalPanel(goal) {
  const enoughPlayers = goal.sampleFresh && goal.onlinePlayers >= goal.targetPlayers;
  const weeklyDone = goal.streak >= 7;
  const missing = Math.max(0, goal.targetPlayers - goal.onlinePlayers);

  const onlineStatus = goal.sampleFresh
    ? `**${goal.onlinePlayers} / ${goal.targetPlayers} players**\n${enoughPlayers ? '✅ Player target reached' : `Need ${missing} more players`}`
    : `**— / ${goal.targetPlayers} players**\nWaiting for live tab-list count`;

  const timerLine = goal.dayQualified ? '✅ Today complete'
    : enoughPlayers ? '🟢 Timer is counting'
      : (goal.secondsToday > 0 ? '⏸ Paused, resumes at the target' : '⏸ Starts when the player target is reached');
  const todayStatus = `**${formatDuration(goal.secondsToday)} / ${formatDuration(goal.requiredSeconds)}**\n${timerLine}`;

  const dots = streakDots(goal.weekHistory);
  const streakStatus = `**${goal.streak} / 7 days**\n${weeklyDone ? '✅ Weekly goal complete' : dots || 'Complete the timer 7 days in a row'}`;

  // One progress bar for today; the streak squares already show the week.
  const resets = goal.resetAt ? `\n-# 🕛 Day resets <t:${goal.resetAt}:R>` : '';
  const fields = [
    { name: '👥 ONLINE NOW', value: onlineStatus, inline: true },
    { name: '⏱ TODAY', value: todayStatus, inline: true },
    { name: '🔥 STREAK', value: streakStatus, inline: true },
    { name: '📈 Today’s timer', value: `${progressBar(goal.secondsToday, goal.requiredSeconds, 10, goal.dayQualified ? '🟩' : '🟨')}${resets}`, inline: false }
  ];
  const heat = buildHeatmap(goal.heatmap);
  if (heat) fields.push({ name: '📊 When players are online', value: heat, inline: false });
  fields.push({ name: '❓ Rules', value: '-# The timer pauses (it does not reset) if the count drops below the target. Missing a full day resets the streak.', inline: false });

  return {
    title: '🏆 ACTIVE PLAYER GOAL',
    color: weeklyDone ? COLORS.weekly : goal.dayQualified ? COLORS.complete : enoughPlayers ? COLORS.counting : COLORS.idle,
    description: `# 🎁 ${goal.prize || 'Prize coming soon'}\nGet **${goal.targetPlayers} players** online together for **${formatDuration(goal.requiredSeconds)} a day**, **7 days in a row**. Hop on and bring a friend!`,
    fields,
    footer: `Tracker runs 24/7 · Timezone: ${goal.timezone}`
  };
}

module.exports = { buildActiveGoalPanel, buildHeatmap, formatDuration, progressBar, COLORS };
