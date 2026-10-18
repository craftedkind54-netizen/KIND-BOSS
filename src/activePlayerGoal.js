'use strict';

const DEFAULTS = Object.freeze({ targetPlayers: 5, requiredSeconds: 2 * 60 * 60, prize: '', timezone: 'Pacific/Honolulu' });
const MAX_SAMPLE_GAP_SECONDS = 90;

function createActivePlayerGoal(db, { timezone = DEFAULTS.timezone, now = () => Date.now() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_goal_days (
      local_day TEXT PRIMARY KEY, seconds INTEGER NOT NULL DEFAULT 0,
      qualified INTEGER NOT NULL DEFAULT 0, qualified_at TEXT
    );
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

  function recordSample(onlinePlayers, timestamp = now()) {
    if (!Number.isSafeInteger(onlinePlayers) || onlinePlayers < 0 || onlinePlayers > 10000) throw new Error('Invalid online player count.');
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
      } else if (onlinePlayers < settings.targetPlayers || gap > MAX_SAMPLE_GAP_SECONDS) {
        state.daySeconds = 0;
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
    state.lastSampleAt = null;
    state.lastOnline = 0;
    if (!state.dayQualified) state.daySeconds = 0;
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
    return { ...settings, day, onlinePlayers: online, sampleFresh: Number.isFinite(sampleAge) && sampleAge <= MAX_SAMPLE_GAP_SECONDS,
      secondsToday: daySeconds, dayQualified, streak };
  }

  return { setGoal, recordSample, markOffline, snapshot };
}

module.exports = { createActivePlayerGoal, DEFAULTS, MAX_SAMPLE_GAP_SECONDS };
