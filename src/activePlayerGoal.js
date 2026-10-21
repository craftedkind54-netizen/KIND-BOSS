'use strict';

const DEFAULTS = Object.freeze({ targetPlayers: 15, requiredSeconds: 2 * 60 * 60, prize: '', timezone: 'Pacific/Honolulu' });
const MAX_SAMPLE_GAP_SECONDS = 90;
const AVERAGE_WINDOW_SECONDS = 7 * 24 * 60 * 60;

function createActivePlayerGoal(db, { timezone = DEFAULTS.timezone, now = () => Date.now() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_goal_days (
      local_day TEXT PRIMARY KEY, seconds INTEGER NOT NULL DEFAULT 0,
      qualified INTEGER NOT NULL DEFAULT 0, qualified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS active_player_samples (
      sampled_at INTEGER PRIMARY KEY, online_players INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS active_player_samples_time ON active_player_samples(sampled_at);
  `);

  const stateKey = 'active_player_goal_state';
  const readState = () => {
    const raw = db.prepare('SELECT value FROM app_state WHERE key=?').get(stateKey)?.value;
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  };
  const writeState = state => db.prepare(`INSERT INTO app_state(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(stateKey, JSON.stringify(state));
  const readSettings = () => {
    const raw = db.prepare("SELECT value FROM app_state WHERE key='active_player_goal_settings'").get()?.value;
    try { return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}), timezone }; } catch { return { ...DEFAULTS, timezone }; }
  };
  const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const getDay = millis => {
    const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(millis)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const getPreviousDay = day => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  };

  function setGoal(targetPlayers, requiredMinutes, prize = '') {
    if (!Number.isSafeInteger(targetPlayers) || targetPlayers < 1 || targetPlayers > 500) throw new Error('Player target must be a whole number from 1 to 500.');
    if (!Number.isSafeInteger(requiredMinutes) || requiredMinutes < 1 || requiredMinutes > 1440) throw new Error('Daily duration must be from 1 to 1440 minutes.');
    const settings = { targetPlayers, requiredSeconds: requiredMinutes * 60, prize: String(prize || '').trim().slice(0, 200), timezone };
    const previousSettings = readSettings();
    db.prepare(`INSERT INTO app_state(key,value) VALUES('active_player_goal_settings',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(settings));
    if (previousSettings.targetPlayers !== targetPlayers || previousSettings.requiredSeconds !== settings.requiredSeconds) {
      const state = readState();
      state.lastSampleAt = null;
      state.lastOnline = 0;
      state.daySeconds = 0;
      state.dayQualified = false;
      state.streak = 0;
      state.lastQualifiedDay = null;
      writeState(state);
      db.prepare('DELETE FROM active_goal_days').run();
    }
    return settings;
  }

  function resetProgress() {
    const state = readState();
    state.lastSampleAt = null;
    state.lastOnline = 0;
    state.daySeconds = 0;
    state.dayQualified = false;
    state.streak = 0;
    state.lastQualifiedDay = null;
    state.currentDay = null;
    state.activeDay = null;
    writeState(state);
    db.prepare('DELETE FROM active_goal_days').run();
  }

  function recordSample(onlinePlayers, timestamp = now()) {
    if (!Number.isSafeInteger(onlinePlayers) || onlinePlayers < 0 || onlinePlayers > 10000) throw new Error('Invalid online player count.');
    const windowStart = timestamp - AVERAGE_WINDOW_SECONDS * 1000;
    db.prepare(`INSERT INTO active_player_samples(sampled_at,online_players) VALUES(?,?)
      ON CONFLICT(sampled_at) DO UPDATE SET online_players=excluded.online_players`).run(timestamp, onlinePlayers);
    db.prepare('DELETE FROM active_player_samples WHERE sampled_at<?').run(windowStart - MAX_SAMPLE_GAP_SECONDS * 1000);
    const settings = readSettings();
    const day = getDay(timestamp);
    let state = readState();
    const previousTimestamp = Number(state.lastSampleAt || 0);
    const gap = previousTimestamp ? Math.floor((timestamp - previousTimestamp) / 1000) : 0;
    const previousDay = state.activeDay;

    if (previousDay !== day) {
      const yesterday = getPreviousDay(day);
      if (state.lastQualifiedDay !== yesterday) state.streak = 0;
      state.activeDay = day;
      state.daySeconds = 0;
      state.dayQualified = false;
    }

    if (!state.dayQualified) {
      if (onlinePlayers >= settings.targetPlayers && state.lastOnline >= settings.targetPlayers && gap > 0 && gap <= MAX_SAMPLE_GAP_SECONDS && previousDay === day) {
        state.daySeconds = Math.min(settings.requiredSeconds, Number(state.daySeconds || 0) + gap);
      }
    }

    state.lastSampleAt = timestamp;
    state.lastOnline = onlinePlayers;
    state.currentDay = day;
    if (!state.dayQualified && state.daySeconds >= settings.requiredSeconds) {
      state.dayQualified = true;
      const yesterday = getPreviousDay(day);
      state.streak = state.lastQualifiedDay === yesterday ? Number(state.streak || 0) + 1 : 1;
      state.lastQualifiedDay = day;
      db.prepare(`INSERT INTO active_goal_days(local_day,seconds,qualified,qualified_at) VALUES(?,?,1,?)
        ON CONFLICT(local_day) DO UPDATE SET seconds=excluded.seconds,qualified=1,qualified_at=excluded.qualified_at`)
        .run(day, state.daySeconds, new Date(timestamp).toISOString());
    } else {
      db.prepare(`INSERT INTO active_goal_days(local_day,seconds,qualified,qualified_at) VALUES(?,?,0,NULL)
        ON CONFLICT(local_day) DO UPDATE SET seconds=MAX(active_goal_days.seconds,excluded.seconds)`)
        .run(day, Number(state.daySeconds || 0));
    }
    writeState(state);
    return snapshot();
  }

  function markOffline(timestamp = now()) {
    const state = readState();
    db.prepare(`INSERT INTO active_player_samples(sampled_at,online_players) VALUES(?,0)
      ON CONFLICT(sampled_at) DO UPDATE SET online_players=0`).run(timestamp);
    state.lastSampleAt = null;
    state.lastOnline = 0;
    writeState(state);
    return snapshot(timestamp);
  }

  function snapshot(timestamp = now()) {
    const settings = readSettings();
    const day = getDay(timestamp);
    const state = readState();
    const sampleAge = state.lastSampleAt ? Math.max(0, (timestamp - Number(state.lastSampleAt)) / 1000) : Infinity;
    const online = sampleAge <= MAX_SAMPLE_GAP_SECONDS ? Number(state.lastOnline || 0) : 0;
    const currentDay = state.currentDay === day;
    const daySeconds = currentDay ? Number(state.daySeconds || 0) : 0;
    const dayQualified = currentDay && Boolean(state.dayQualified);
    const yesterday = getPreviousDay(day);
    const streak = state.lastQualifiedDay === day || state.lastQualifiedDay === yesterday ? Number(state.streak || 0) : 0;
    const averageWindowStart = timestamp - AVERAGE_WINDOW_SECONDS * 1000;
    const samples = db.prepare(`SELECT sampled_at,online_players FROM active_player_samples
      WHERE sampled_at>=? AND sampled_at<=? ORDER BY sampled_at ASC`)
      .all(averageWindowStart - MAX_SAMPLE_GAP_SECONDS * 1000, timestamp);
    let activePlayerSeconds = 0;
    let averageCoverageSeconds = 0;
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const start = Math.max(averageWindowStart, Number(sample.sampled_at));
      const nextSampleAt = index + 1 < samples.length ? Number(samples[index + 1].sampled_at) : timestamp;
      const end = Math.min(timestamp, nextSampleAt, Number(sample.sampled_at) + MAX_SAMPLE_GAP_SECONDS * 1000);
      const seconds = Math.max(0, (end - start) / 1000);
      activePlayerSeconds += seconds * Number(sample.online_players);
      averageCoverageSeconds += seconds;
    }
    const averageOnlinePlayers = averageCoverageSeconds > 0 ? activePlayerSeconds / averageCoverageSeconds : null;
    return { ...settings, day, onlinePlayers: online, sampleFresh: Number.isFinite(sampleAge) && sampleAge <= MAX_SAMPLE_GAP_SECONDS,
      secondsToday: daySeconds, dayQualified, streak, averageOnlinePlayers, averageCoverageSeconds,
      averageWindowSeconds: AVERAGE_WINDOW_SECONDS };
  }

  return { setGoal, resetProgress, recordSample, markOffline, snapshot };
}

module.exports = { createActivePlayerGoal, DEFAULTS, MAX_SAMPLE_GAP_SECONDS, AVERAGE_WINDOW_SECONDS };
