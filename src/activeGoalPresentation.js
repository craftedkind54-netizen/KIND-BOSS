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
  { at: 1, emoji: '🟩', label: 'goal' },
  { at: 0.75, emoji: '🟨', label: '75%' },
  { at: 0.5, emoji: '🟧', label: '50%' },
  { at: 0.25, emoji: '🟪', label: '25%' },
  { at: 0.0001, emoji: '🟦', label: '<25%' }
];
const NO_PLAYERS = '⬛';
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
// With `forecastDay` (a weekday 0-6), the chart forecasts that day from the
// same weekday last week; dayStart is then that day's local midnight.
function buildHeatmap(heatmap, target, dayStart, forecastDay = null) {
  const cells = heatmap?.cells;
  if (!Array.isArray(cells) || !cells.some(row => row.some(value => value != null))) return null;
  const step = heatmap.bucketHours || 1;
  const hours = cells[0].length;
  const label = b => dayStart ? `<t:${dayStart + b * step * 3600}:t>` : `\`${hourLabel(b * step)}\``;
  // A typical day: average each time block across every day that has data.
  const typical = [];
  for (let b = 0; b < hours; b++) {
    const values = cells.map(row => row[b]).filter(value => value != null);
    typical.push(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  }
  const dayRow = forecastDay != null ? cells[forecastDay] : null;
  const useDay = Array.isArray(dayRow) && dayRow.some(value => value != null);
  if (useDay) dayRow.forEach((value, b) => { if (value != null) typical[b] = value; });
  const dayName = useDay ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][forecastDay] : null;
  const ranked = typical.map((value, b) => ({ value, b })).filter(item => item.value > 0).sort((a, z) => z.value - a.value);
  const top = new Set(ranked.slice(0, 3).map(item => item.b));

  // Bar first (left-aligned, spaced squares), then the time in the viewer's zone.
  const WIDTH = 8;
  const rows = typical.map((value, b) => {
    const filled = value > 0 ? Math.max(1, Math.min(WIDTH, Math.round(value / target * WIDTH))) : 0;
    const bar = [...Array(filled).fill(heatLevel(value, target)), ...Array(WIDTH - filled).fill('▫️')].join(' ');
    const avg = value > 0 ? ` · ${value.toFixed(1)}` : '';
    return `${bar}   ${label(b)}${avg}${top.has(b) ? ' ⭐' : ''}`;
  });

  const intro = dayName
    ? `-# 🔮 Tomorrow's forecast (${dayName}) · based on last ${dayName} · your time zone`
    : `-# Typical day last week · avg players online · your time zone`;
  const lines = [intro, ...rows];
  if (ranked.length) {
    const best = ranked[0];
    lines.push(`🎯 ${dayName ? `Best time to join tomorrow: **${label(best.b)}**` : `Most players are on around **${label(best.b)}**`} (~${best.value.toFixed(1)} players, ${Math.round(best.value / target * 100)}% of the goal)`);
  }
  lines.push(`-# Share of the ${target}-player goal: ${HEAT.slice().reverse().map(level => `${level.emoji} ${level.label}`).join('  ')} · ⭐ top 3 times`);
  return [{ name: dayName ? `📊 When players will be online tomorrow` : '📊 When players are online', value: lines.join('\n'), inline: false }];
}

// Forecast this week from last week: heatmap cells are 7 days back, so each
// weekday column is that same day last week. Hours "at goal" = blocks whose
// average reached the target.
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function buildForecast(goal) {
  const cells = goal.heatmap?.cells;
  if (!Array.isArray(cells) || !cells.some(row => row.some(value => value != null))) return null;
  const step = goal.heatmap.bucketHours || 1;
  const target = goal.targetPlayers;
  const days = cells.map((row, d) => {
    const known = row.map((value, b) => ({ value, b })).filter(item => item.value != null);
    const peak = known.reduce((best, item) => (item.value > (best?.value ?? -1) ? item : best), null);
    const goalSeconds = known.filter(item => item.value >= target).length * step * 3600;
    return { d, hasData: known.length > 0, peak, goalSeconds, qualifies: goalSeconds >= goal.requiredSeconds };
  });
  const weekday = Number.isInteger(goal.localWeekday) ? goal.localWeekday : null;
  const bucket = Number.isInteger(goal.localHour) ? Math.floor(goal.localHour / step) : null;
  const expectedNow = weekday != null && bucket != null ? cells[weekday]?.[bucket] ?? null : null;
  return { days, step, today: weekday != null ? days[weekday] : null, expectedNow, likelyDays: days.filter(day => day.qualifies).length };
}

function forecastField(forecast, goal) {
  const lines = ['-# Based on the same day last week · peak players · time at the goal'];
  for (const day of forecast.days) {
    const isToday = forecast.today && day.d === forecast.today.d;
    const name = isToday ? `**${DAY_NAMES[day.d]}**` : DAY_NAMES[day.d];
    if (!day.hasData) { lines.push(`⬛ ${name} · no data yet`); continue; }
    const icon = day.qualifies ? '🟩' : heatLevel(day.peak.value, goal.targetPlayers);
    const peakAt = hourLabel(day.peak.b * forecast.step).trim();
    const older = goal.heatmap.filledDays?.includes(day.d) ? ' · *(older weeks)*' : '';
    lines.push(`${icon} ${name} · peak ~${day.peak.value.toFixed(1)} at ${peakAt} · ${formatDuration(day.goalSeconds)} at goal${day.qualifies ? ' ✅' : ''}${older}`);
  }
  const need = forecast.likelyDays >= 7 ? '🔥 On pace for the full 7-day streak!'
    : `Likely streak days: **${forecast.likelyDays} / 7**. Bring friends at peak times to push it up!`;
  lines.push(need);
  return { name: '🔮 This week’s forecast', value: lines.join('\n'), inline: false };
}

function buildActiveGoalPanel(goal) {
  const forecast = buildForecast(goal);
  const enoughPlayers = goal.sampleFresh && goal.onlinePlayers >= goal.targetPlayers;
  const weeklyDone = goal.streak >= 7;
  const missing = Math.max(0, goal.targetPlayers - goal.onlinePlayers);

  // The forecast line is the same whether or not a live count is available.
  const onlineStatus = goal.sampleFresh
    ? `Active right now:\n**${goal.onlinePlayers} / ${goal.targetPlayers} players**\n${enoughPlayers ? '✅ Player target reached' : `Need ${missing} more players`}`
    : `Active right now:\n**— / ${goal.targetPlayers} players**\nWaiting for live tab-list count`;
  const step = goal.heatmap?.bucketHours || 2;
  const lastWeekNow = forecast?.expectedNow != null
    ? `\n-# Last week, this ${step}h block: ~${forecast.expectedNow.toFixed(1)} players` : '';
  const todayCount = lastWeekNow + (goal.today?.average != null
    ? `\n-# Today: avg ${goal.today.average.toFixed(1)} · peak ${goal.today.peak}` : '\n-# Today: no players counted yet');

  const timerLine = goal.dayQualified ? '✅ Today complete'
    : enoughPlayers ? '🟢 Timer is counting'
      : (goal.secondsToday > 0 ? '⏸ Paused, resumes at the target' : '⏸ Starts when the player target is reached');
  const todayForecast = !goal.dayQualified && forecast?.today?.hasData
    ? `\n-# Forecast: ~${formatDuration(forecast.today.goalSeconds)} at goal today` : '';
  const todayStatus = `**${formatDuration(goal.secondsToday)} / ${formatDuration(goal.requiredSeconds)}**\n${timerLine}${todayForecast}`;

  const dots = streakDots(goal.weekHistory);
  const streakForecast = !weeklyDone && forecast ? `\n-# Forecast: ${forecast.likelyDays} / 7 days` : '';
  const streakStatus = `**${goal.streak} / 7 days**\n${weeklyDone ? '✅ Weekly goal complete' : dots || 'Complete the timer 7 days in a row'}${streakForecast}`;

  // One progress bar for today; the streak squares already show the week.
  const resets = goal.resetAt ? `\n-# 🕛 Day resets <t:${goal.resetAt}:R>` : '';
  const fields = [
    { name: '👥 ONLINE NOW', value: onlineStatus + todayCount, inline: true },
    { name: '⏱ TODAY', value: todayStatus, inline: true },
    { name: '🔥 STREAK', value: streakStatus, inline: true },
    { name: '📈 Today’s timer', value: `${goal.secondsToday > 0 ? progressBar(goal.secondsToday, goal.requiredSeconds, 10, goal.dayQualified ? '🟩' : '🟨') : 'No time counted yet today'}${resets}`, inline: false }
  ];
  // Chart forecasts tomorrow (midnight = resetAt) so players can plan when to join.
  const tomorrow = Number.isInteger(goal.localWeekday) ? (goal.localWeekday + 1) % 7 : null;
  const heat = tomorrow != null
    ? buildHeatmap(goal.heatmap, goal.targetPlayers, goal.resetAt || null, tomorrow)
    : buildHeatmap(goal.heatmap, goal.targetPlayers, goal.resetAt ? goal.resetAt - 86400 : null);
  if (heat) fields.push(...heat);
  if (forecast) fields.push(forecastField(forecast, goal));
  fields.push({ name: '❓ Rules', value: '-# The timer pauses (it does not reset) if the count drops below the target. Missing a full day resets the streak.', inline: false });

  return {
    title: '🏆 ACTIVE PLAYER GOAL',
    color: weeklyDone ? COLORS.weekly : goal.dayQualified ? COLORS.complete : enoughPlayers ? COLORS.counting : COLORS.idle,
    description: `# 🎁 ${goal.prize || 'Prize coming soon'}\nGet **${goal.targetPlayers} players** online together for **${formatDuration(goal.requiredSeconds)} a day**, **7 days in a row**. Hop on and bring a friend!`,
    fields,
    footer: `Tracker runs 24/7 · Timezone: ${goal.timezone}`
  };
}

module.exports = { buildActiveGoalPanel, buildHeatmap, buildForecast, formatDuration, progressBar, COLORS };
