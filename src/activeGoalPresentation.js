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
// Cool-to-hot ramp; empty hours stay dark so busy times stand out.
const HEAT = [
  { at: 1, emoji: '🟢', label: 'goal' },
  { at: 0.75, emoji: '🟡', label: '75%' },
  { at: 0.5, emoji: '🟠', label: '50%' },
  { at: 0.25, emoji: '🟣', label: '25%' },
  { at: 0.0001, emoji: '🔵', label: '<25%' }
];
const NO_PLAYERS = '⚫';
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

// "When players are online" grid: one row per time block, one column per day
// of the current week (Sun..Sat, with dates on top). Each square is a
// prediction for this week: last week's average players at that day and time.
// Row labels are Discord timestamps, so every viewer sees their own time zone.
// dayStart is the unix second of today's server-local midnight.
const DAY_LETTERS = ['🇸', '🇲', '🇹', '🇼', '🇹', '🇫', '🇸'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function buildHeatmap(heatmap, target, dayStart, todayWeekday = null, timezone = 'UTC') {
  const cells = heatmap?.cells;
  if (!Array.isArray(cells) || !cells.some(row => row.some(value => value != null))) return null;
  const step = heatmap.bucketHours || 1;
  const hours = cells[0].length;
  const label = b => dayStart ? `<t:${dayStart + b * step * 3600}:t>` : `\`${hourLabel(b * step)}\``;

  // Average across the week per time block, used to star the busiest times.
  const typical = [];
  for (let b = 0; b < hours; b++) {
    const values = cells.map(row => row[b]).filter(value => value != null);
    typical.push(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  }
  const ranked = typical.map((value, b) => ({ value, b })).filter(item => item.value > 0).sort((a, z) => z.value - a.value);
  const top = new Set(ranked.slice(0, 3).map(item => item.b));

  // Header: day letters (separated by spaces so they never merge into flags),
  // and the dates of this week's Sunday..Saturday.
  const header = `${DAY_LETTERS.join(' ')}`;
  let dates = '';
  if (dayStart && Number.isInteger(todayWeekday)) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'numeric', day: 'numeric' });
    const weekStart = dayStart - todayWeekday * 86400;
    const day = d => fmt.format(new Date((weekStart + d * 86400 + 43200) * 1000));
    dates = `-# This week: ${DAY_NAMES.map((name, d) => d === todayWeekday ? `**${name} ${day(d)}**` : `${name} ${day(d)}`).join(' · ')}`;
  }

  const rows = Array.from({ length: hours }, (_, b) => {
    const squares = cells.map(row => heatLevel(row[b], target)).join(' ');
    return `${squares}   ${label(b)}${top.has(b) ? ' ⭐' : ''}`;
  });

  const lines = [`-# Predicted from last week's player counts · your time zone`];
  if (dates) lines.push(dates);
  lines.push(header, ...rows);
  if (ranked.length) {
    const best = ranked[0];
    lines.push(`🎯 Most players are on around **${label(best.b)}** (avg ${best.value.toFixed(1)}, ${Math.round(best.value / target * 100)}% of the goal)`);
  }
  lines.push(`-# Share of the ${target}-player goal: ${NO_PLAYERS} none  ${HEAT.slice().reverse().map(level => `${level.emoji} ${level.label}`).join('  ')} · ⭐ busiest times`);
  return [{ name: '📊 When players are online this week', value: lines.join('\n'), inline: false }];
}

function buildActiveGoalPanel(goal) {
  const enoughPlayers = goal.sampleFresh && goal.onlinePlayers >= goal.targetPlayers;
  const weeklyDone = goal.streak >= 7;
  const missing = Math.max(0, goal.targetPlayers - goal.onlinePlayers);

  const onlineStatus = goal.sampleFresh
    ? `Active right now:\n**${goal.onlinePlayers} / ${goal.targetPlayers} players**\n${enoughPlayers ? '✅ Player target reached' : `Need ${missing} more players`}`
    : `Active right now:\n**— / ${goal.targetPlayers} players**\nWaiting for live tab-list count`;
  const step = goal.heatmap?.bucketHours || 2;
  const bucket = Number.isInteger(goal.localHour) ? Math.floor(goal.localHour / step) : null;
  const lastWeekValue = Number.isInteger(goal.localWeekday) && bucket != null ? goal.heatmap?.cells?.[goal.localWeekday]?.[bucket] ?? null : null;
  const lastWeekNow = lastWeekValue != null ? `\n-# Last week, this ${step}h block: ~${Math.round(lastWeekValue)} ${Math.round(lastWeekValue) === 1 ? "player" : "players"}` : '';
  const todayCount = lastWeekNow + (goal.today?.average != null
    ? `\n-# Today: avg ${goal.today.average.toFixed(1)} · peak ${goal.today.peak}` : '\n-# Today: no players counted yet');

  const timerLine = goal.dayQualified ? '✅ Today complete'
    : enoughPlayers ? '🟢 Timer is counting'
      : (goal.secondsToday > 0 ? '⏸ Paused, resumes at the target' : '⏸ Starts when the player target is reached');
  const todayStatus = `**${formatDuration(goal.secondsToday)} / ${formatDuration(goal.requiredSeconds)}**\n${timerLine}`;

  const dots = streakDots(goal.weekHistory);
  const streakStatus = `**${goal.streak} / 7 days**\n${weeklyDone ? '✅ Weekly goal complete' : dots || 'Complete the timer 7 days in a row'}`;

  // One progress bar for today; the streak squares already show the week.
  const resets = goal.resetAt ? `\n-# 🕛 Day resets <t:${goal.resetAt}:R>` : '';
  const fields = [
    { name: '👥 ONLINE NOW', value: onlineStatus + todayCount, inline: true },
    { name: '⏱ TODAY', value: todayStatus, inline: true },
    { name: '🔥 STREAK', value: streakStatus, inline: true },
    { name: '📈 Today’s timer', value: `${goal.secondsToday > 0 ? progressBar(goal.secondsToday, goal.requiredSeconds, 10, goal.dayQualified ? '🟩' : '🟨') : 'No time counted yet today'}${resets}`, inline: false }
  ];
  const heat = buildHeatmap(goal.heatmap, goal.targetPlayers, goal.resetAt ? goal.resetAt - 86400 : null, goal.localWeekday, goal.timezone);
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
