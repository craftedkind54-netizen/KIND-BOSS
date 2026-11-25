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
  return `${fill.repeat(filled)}${'▫️'.repeat(width - filled)} ${Math.round(fraction * 100)}%`;
}

function streakDots(history) {
  if (!Array.isArray(history) || !history.length) return '';
  // Missed days are a quiet grey square so a new streak doesn't open on a wall of red X's.
  return history.map(day => day === true ? '✅' : day === false ? '▫️' : '⏳').join('');
}

// Colour = average players online in that hour as a share of the goal target.
const HEAT = [
  { at: 1, emoji: '🟩', label: '100%' },
  { at: 0.75, emoji: '🟨', label: '75%' },
  { at: 0.5, emoji: '🟧', label: '50%' },
  { at: 0.25, emoji: '🟥', label: '25%' },
  { at: 0.0001, emoji: '🟫', label: '1%' }
];
const NO_PLAYERS = '⬜';
function heatLevel(value, target) {
  if (value == null || value <= 0 || !(target > 0)) return NO_PLAYERS;
  const share = value / target;
  return (HEAT.find(level => share >= level.at) || HEAT[HEAT.length - 1]).emoji;
}

function hourLabel(hour) {
  const suffix = hour < 12 ? 'a' : 'p';
  const h = hour % 12 || 12;
  return `${String(h).padStart(2, ' ')}${suffix}`;
}

// Hourly heatmap: one row per hour, one column per weekday (Sun..Sat).
// Row labels are Discord timestamps, so every viewer sees the hours in their
// own time zone. dayStart is the unix second of today's server-local midnight.
// Returns several embed fields (each field value must stay under 1024 chars).
function buildHeatmap(heatmap, target, dayStart) {
  const cells = heatmap?.cells;
  if (!Array.isArray(cells) || !cells.some(row => row.some(value => value != null))) return null;
  const step = heatmap.bucketHours || 1;
  const hours = cells[0].length;
  const label = b => dayStart ? `<t:${dayStart + b * step * 3600}:t>` : `\`${hourLabel(b * step)}\``;
  const rows = [];
  for (let b = 0; b < hours; b++) rows.push(`${label(b)} ${cells.map(row => heatLevel(row[b], target)).join('')}`);

  let peak = null;
  cells.forEach((row, d) => row.forEach((value, b) => { if (value != null && (!peak || value > peak.value)) peak = { value, d, b }; }));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const header = '-# Columns: Sun Mon Tue Wed Thu Fri Sat · times shown in your time zone';
  const half = Math.ceil(rows.length / 2);
  const fields = [
    { name: '📊 When players are online', value: `${header}\n${rows.slice(0, half).join('\n')}`, inline: false },
    { name: '​', value: rows.slice(half).join('\n'), inline: false }
  ];
  const summary = [];
  if (peak) {
    const pct = Math.round(peak.value / target * 100);
    summary.push(`🎯 Best time to play: **${days[peak.d]} ${label(peak.b)}** (avg ${peak.value.toFixed(1)} online, ${pct}% of goal)`);
  }
  summary.push(`-# % of the ${target}-player goal online: ${HEAT.slice().reverse().map(level => `${level.emoji} ${level.label}+`).join(' ')} ${NO_PLAYERS} nobody · last 28 days`);
  fields.push({ name: '​', value: summary.join('\n'), inline: false });
  return fields;
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
    { name: '📈 Today’s timer', value: `${goal.secondsToday > 0 ? progressBar(goal.secondsToday, goal.requiredSeconds, 10, goal.dayQualified ? '🟩' : '🟨') : 'No time counted yet today'}${resets}`, inline: false }
  ];
  const heat = buildHeatmap(goal.heatmap, goal.targetPlayers, goal.resetAt ? goal.resetAt - 86400 : null);
  if (heat) fields.push(...heat);
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
