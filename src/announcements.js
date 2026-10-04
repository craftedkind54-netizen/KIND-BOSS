require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  PermissionsBitField,
} = require('discord.js');

// =====================================================
// CRAFTED SMP ANNOUNCEMENT BOT
// =====================================================

const TOKEN = process.env.DISCORD_TOKEN;

// =====================================================
// CHANNEL IDS
// =====================================================

const ANNOUNCEMENTS_CHANNEL_ID = process.env.ANNOUNCEMENTS_CHANNEL_ID || '1555825214045163520';
const FLASH_CHANNEL_ID = process.env.FLASH_CHANNEL_ID || '1555845538551963678';
const CONTROL_CHANNEL_ID = process.env.CONTROL_CHANNEL_ID || process.env.ANNOUNCEMENTS_CHANNEL_ID || '1555825214045163520';
const EVENTS_CHANNEL_ID = process.env.EVENTS_CHANNEL_ID || '1555840522143277056';
const POLLS_CHANNEL_ID = process.env.POLLS_CHANNEL_ID || '1555840657434615928';

// =====================================================
// NOTIFICATION ROLE IDS
// =====================================================

const FLASH_ROLE_ID = process.env.FLASH_ROLE_ID || process.env.GENERAL_STAFF_ROLE_ID || '1555840026607362099';
const EVENT_ROLE_ID = process.env.EVENT_ROLE_ID || process.env.GENERAL_STAFF_ROLE_ID || '1555840026607362099';
const POLL_ROLE_ID = process.env.POLL_ROLE_ID || process.env.GENERAL_STAFF_ROLE_ID || '1555840026607362099';

// =====================================================
// STORAGE
// =====================================================

const DATA_DIR = process.env.PERSISTENT_DATA_DIR || process.env.DATA_DIR || '/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SCHEDULE_FILE = path.join(DATA_DIR, 'scheduled-content.json');
console.log(`[Announcements] Persistent schedule file: ${SCHEDULE_FILE}`);
const drafts = new Map();

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = global.__KIND_BOSS_CLIENT;

// =====================================================
// TIMEZONES
// =====================================================

const TIMEZONES = {
  HST: 'Pacific/Honolulu',
  HAWAII: 'Pacific/Honolulu',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  PACIFIC: 'America/Los_Angeles',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  MOUNTAIN: 'America/Denver',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  CENTRAL: 'America/Chicago',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  EASTERN: 'America/New_York',
  UTC: 'UTC',
  GMT: 'UTC',
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function isStaff(interaction) {
  return interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
}

function hasAnnouncement(type) {
  return ['announcement', 'flash', 'announcement_event', 'announcement_poll', 'announcement_event_poll'].includes(type);
}

function hasEvents(type) {
  return ['event', 'announcement_event', 'announcement_event_poll'].includes(type);
}

function hasPoll(type) {
  return ['poll', 'announcement_poll', 'announcement_event_poll'].includes(type);
}

function resolveTimezone(input) {
  if (!input) return null;
  const original = String(input).trim();
  const upper = original.toUpperCase();
  if (TIMEZONES[upper]) return { label: upper, zone: TIMEZONES[upper] };
  const test = DateTime.now().setZone(original);
  if (test.isValid) return { label: original, zone: original };
  return null;
}

function parseUserDate(input, timezoneInput = 'HST') {
  if (!input) return null;
  const timezone = resolveTimezone(timezoneInput);
  if (!timezone) return null;
  const value = String(input).trim();
  const lower = value.toLowerCase();
  const now = DateTime.now().setZone(timezone.zone);
  if (lower === 'today') return now.startOf('day');
  if (lower === 'tomorrow') return now.plus({ days: 1 }).startOf('day');

  const formats = [
    'yyyy-M-d', 'yyyy-MM-dd', 'M/d/yyyy', 'MM/dd/yyyy',
    'M-d-yyyy', 'MM-dd-yyyy', 'LLLL d yyyy', 'LLLL d, yyyy',
    'LLL d yyyy', 'LLL d, yyyy',
  ];

  for (const format of formats) {
    const parsed = DateTime.fromFormat(value, format, { zone: timezone.zone, locale: 'en-US' });
    if (parsed.isValid) return parsed.startOf('day');
  }
  return null;
}

function parseClockTime(input) {
  if (!input) return null;
  const value = String(input).trim().replace(/\s+/g, ' ').replace(/a\.?m\.?/gi, 'AM').replace(/p\.?m\.?/gi, 'PM');
  const formats = ['h a', 'h:mm a', 'ha', 'h:mma', 'H:mm', 'HH:mm'];
  for (const format of formats) {
    const parsed = DateTime.fromFormat(value.toUpperCase(), format, { locale: 'en-US' });
    if (parsed.isValid) return { hour: parsed.hour, minute: parsed.minute };
  }
  return null;
}

function makeDiscordTimestamp(dateInput, timeInput, timezoneInput) {
  const timezone = resolveTimezone(timezoneInput);
  const date = parseUserDate(dateInput, timezoneInput);
  const time = parseClockTime(timeInput);
  if (!timezone || !date || !time) return null;

  const final = date.setZone(timezone.zone).set({
    hour: time.hour,
    minute: time.minute,
    second: 0,
    millisecond: 0,
  });

  if (!final.isValid) return null;

  return {
    timestamp: Math.floor(final.toSeconds()),
    normalizedDate: final.toFormat('yyyy-MM-dd'),
    timezone: timezone.label,
  };
}

const TIME_ZONE_NAMES = 'HST|HAWAII|PST|PDT|PACIFIC|MST|MDT|MOUNTAIN|CST|CDT|CENTRAL|EST|EDT|EASTERN|UTC|GMT';

function convertTimesInText(text = '', fallbackDate = null) {
  if (!text) return '';
  let output = String(text);

  const dated = new RegExp(
    `\\b(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4})\\s*(?:at\\s*)?((?:1[0-2]|0?[1-9])(?::[0-5]\\d)?\\s*(?:AM|PM))\\s*(${TIME_ZONE_NAMES})\\b`,
    'gi'
  );

  output = output.replace(dated, (original, date, time, timezone) => {
    const result = makeDiscordTimestamp(date, time, timezone);
    return result ? `<t:${result.timestamp}:F> (<t:${result.timestamp}:R>)` : original;
  });

  const relative = new RegExp(
    `\\b(today|tomorrow)\\s*(?:at\\s*)?((?:1[0-2]|0?[1-9])(?::[0-5]\\d)?\\s*(?:AM|PM))\\s*(${TIME_ZONE_NAMES})\\b`,
    'gi'
  );

  output = output.replace(relative, (original, date, time, timezone) => {
    const result = makeDiscordTimestamp(date, time, timezone);
    return result ? `<t:${result.timestamp}:F> (<t:${result.timestamp}:R>)` : original;
  });

  if (fallbackDate) {
    const simple = new RegExp(
      `\\b((?:1[0-2]|0?[1-9])(?::[0-5]\\d)?\\s*(?:AM|PM))\\s*(${TIME_ZONE_NAMES})\\b`,
      'gi'
    );
    output = output.replace(simple, (original, time, timezone) => {
      const result = makeDiscordTimestamp(fallbackDate, time, timezone);
      return result ? `<t:${result.timestamp}:F> (<t:${result.timestamp}:R>)` : original;
    });
  }

  return output;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function convertChannelMentions(text, guild) {
  if (!text || !guild) return text || '';
  let output = String(text);
  const channels = Array.from(guild.channels.cache.values())
    .filter(channel => channel.name)
    .sort((a, b) => b.name.length - a.name.length);

  for (const channel of channels) {
    const regex = new RegExp(`#${escapeRegex(channel.name)}(?=\\s|$|[.,!?;:])`, 'gi');
    output = output.replace(regex, `<#${channel.id}>`);
  }
  return output;
}

async function resolveMemberByName(guild, searchName) {
  if (!guild || !searchName) return null;
  const wanted = String(searchName).trim().toLowerCase();

  const cached = guild.members.cache.find(member => {
    const username = member.user?.username?.toLowerCase();
    const display = member.displayName?.toLowerCase();
    const nickname = member.nickname?.toLowerCase();
    return username === wanted || display === wanted || nickname === wanted;
  });

  if (cached) return cached;

  try {
    const results = await guild.members.search({ query: searchName, limit: 25 });
    const exact = results.find(member => {
      const username = member.user?.username?.toLowerCase();
      const display = member.displayName?.toLowerCase();
      const nickname = member.nickname?.toLowerCase();
      return username === wanted || display === wanted || nickname === wanted;
    });
    if (exact) return exact;
    if (results.size === 1) return results.first();
  } catch (error) {
    console.warn(`Could not resolve @${searchName}:`, error.message);
  }
  return null;
}

async function convertUserMentions(text, guild) {
  if (!text || !guild) return text || '';
  let output = String(text);
  const regex = /(^|[\s(])@([A-Za-z0-9_.-]{1,32})(?=\s|$|[.,!?;:)'"])/g;
  const matches = Array.from(output.matchAll(regex));
  const names = [...new Set(matches.map(match => match[2]))];

  for (const name of names) {
    const member = await resolveMemberByName(guild, name);
    if (!member) continue;
    const mentionRegex = new RegExp(`(^|[\\s(])@${escapeRegex(name)}(?=\\s|$|[.,!?;:)'"])`, 'gi');
    output = output.replace(mentionRegex, (full, prefix) => `${prefix}<@${member.id}>`);
  }
  return output;
}

async function convertInlineMentions(text, guild) {
  let output = String(text || '');
  output = convertChannelMentions(output, guild);
  output = await convertUserMentions(output, guild);
  return output;
}

function loadSchedules() {
  try {
    if (!fs.existsSync(SCHEDULE_FILE)) {
      fs.writeFileSync(SCHEDULE_FILE, '[]');
      return [];
    }
    return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8') || '[]');
  } catch (error) {
    console.error('Schedule read error:', error);
    return [];
  }
}

function saveSchedules(schedules) {
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2));
}

function addSchedule(draft) {
  const schedules = loadSchedules();
  schedules.push(clone(draft));
  saveSchedules(schedules);
}

function removeSchedule(id) {
  saveSchedules(loadSchedules().filter(item => item.id !== id));
}

function replaceSchedule(id, draft) {
  const schedules = loadSchedules();
  const index = schedules.findIndex(item => item.id === id);
  const copy = clone(draft);
  copy.id = id;
  copy.editingScheduledId = null;
  if (index === -1) schedules.push(copy);
  else schedules[index] = copy;
  saveSchedules(schedules);
}

function createDraft(userId, type) {
  const draft = {
    id: makeId(),
    userId,
    type,
    editingScheduledId: null,
    announcement: {
      title: '',
      description: '',
      extra: '',
      image: '',
      pingEveryone: false,
      completed: false,
    },
    events: [],
    poll: {
      question: '',
      answerCount: 2,
      answers: [],
      duration: 24,
      multiple: false,
      setupCompleted: false,
      answersCompleted: false,
    },
    schedule: {
      enabled: false,
      date: '',
      time: '',
      timezone: 'HST',
      timestamp: null,
      flashPing: 'ROLE',
      picker: {
        year: null,
        month: null,
        day: null,
        hour: null,
        minute: null,
        ampm: null,
      },
    },
    calendar: {
      year: null,
      month: null,
      selectedDate: null,
    },
  };

  drafts.set(userId, draft);
  return draft;
}

function draftReady(draft) {
  if (hasAnnouncement(draft.type) && !draft.announcement.completed) return false;
  if (hasEvents(draft.type) && draft.events.length === 0) return false;
  if (hasPoll(draft.type) && (!draft.poll.setupCompleted || !draft.poll.answersCompleted)) return false;
  return true;
}

function dashboardEmbed() {
  return new EmbedBuilder()
    .setTitle('🛠️ KIND SMP Announcement Dashboard')
    .setDescription([
      'Create KIND SMP content here.',
      '',
      '📢 Announcement',
      '⚡ Flash Announcement',
      '📅 Event',
      '📊 Poll',
      '🚀 Combined Posts',
      '',
      '**Notifications**',
      '',
      '⚡ Flash → ROLE or EVERYONE',
      '🕒 Scheduled Flash Warning → ROLE or EVERYONE',
      '📅 Events → @Events',
      '📊 Polls → @Polls',
    ].join('\n'));
}

function dashboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('create_content').setLabel('Create Content').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('manage_scheduled').setLabel('Scheduled Content').setEmoji('🕒').setStyle(ButtonStyle.Secondary)
  );
}

async function createDashboard() {
  const channel = await client.channels.fetch(CONTROL_CHANNEL_ID);
  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = messages.find(message =>
    message.author.id === client.user.id &&
    message.embeds?.[0]?.title === '🛠️ KIND SMP Announcement Dashboard'
  );

  if (existing) {
    await existing.edit({ embeds: [dashboardEmbed()], components: [dashboardButtons()] });
    return;
  }

  await channel.send({ embeds: [dashboardEmbed()], components: [dashboardButtons()] });
}

function contentMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('content_type')
      .setPlaceholder('Choose what to create')
      .addOptions(
        { label: 'Announcement', value: 'announcement', emoji: '📢' },
        { label: 'Flash Announcement', value: 'flash', emoji: '⚡' },
        { label: 'Event', value: 'event', emoji: '📅' },
        { label: 'Poll', value: 'poll', emoji: '📊' },
        { label: 'Announcement + Event', value: 'announcement_event', emoji: '📣' },
        { label: 'Announcement + Poll', value: 'announcement_poll', emoji: '🗳️' },
        { label: 'Announcement + Event + Poll', value: 'announcement_event_poll', emoji: '🚀' }
      )
  );
}

function announcementModal(draft) {
  const isFlash = draft.type === 'flash';
  const modal = new ModalBuilder()
    .setCustomId('announcement_modal')
    .setTitle(isFlash ? 'Flash Announcement' : 'Announcement');

  if (!isFlash) {
    const title = new TextInputBuilder()
      .setCustomId('announcement_title')
      .setLabel('Announcement Title')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    if (draft.announcement.title) title.setValue(draft.announcement.title);
    modal.addComponents(new ActionRowBuilder().addComponents(title));
  }

  const description = new TextInputBuilder()
    .setCustomId('announcement_description')
    .setLabel(isFlash ? 'Flash Announcement Message' : 'Announcement Description')
    .setPlaceholder(isFlash ? 'Type your Flash Announcement...' : 'Type the announcement here...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);
  if (draft.announcement.description) description.setValue(draft.announcement.description);

  const extra = new TextInputBuilder()
    .setCustomId('announcement_extra')
    .setLabel('Extra Information')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);
  if (draft.announcement.extra) extra.setValue(draft.announcement.extra);

  const image = new TextInputBuilder()
    .setCustomId('announcement_image')
    .setLabel('Image URL')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  if (draft.announcement.image) image.setValue(draft.announcement.image);

  const ping = new TextInputBuilder()
    .setCustomId('announcement_ping')
    .setLabel(isFlash ? 'Ping EVERYONE or ROLE?' : 'Ping @everyone? YES or NO')
    .setPlaceholder(isFlash ? 'ROLE = Flash users | EVERYONE = everyone' : 'YES or NO')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(isFlash ? (draft.announcement.pingEveryone ? 'EVERYONE' : 'ROLE') : (draft.announcement.pingEveryone ? 'YES' : 'NO'));

  modal.addComponents(
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(extra),
    new ActionRowBuilder().addComponents(image),
    new ActionRowBuilder().addComponents(ping)
  );

  return modal;
}

function calendarYearRow() {
  const year = DateTime.now().year;
  const options = [];
  for (let y = year; y <= year + 4; y++) options.push({ label: String(y), value: String(y) });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('calendar_year').setPlaceholder('Select Year').addOptions(options)
  );
}

function calendarMonthRow() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('calendar_month')
      .setPlaceholder('Select Month')
      .addOptions(months.map((month, index) => ({ label: month, value: String(index + 1) })))
  );
}

function calendarDayRows(year, month) {
  const days = DateTime.local(year, month, 1).daysInMonth;
  const first = [];
  const second = [];
  for (let day = 1; day <= days; day++) {
    const option = { label: String(day), value: String(day) };
    if (day <= 25) first.push(option);
    else second.push(option);
  }

  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('calendar_day_1').setPlaceholder('Select Day').addOptions(first)
    ),
  ];

  if (second.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('calendar_day_2').setPlaceholder('Day 26-31').addOptions(second)
    ));
  }
  return rows;
}

function eventModal() {
  const modal = new ModalBuilder().setCustomId('event_modal').setTitle('Create Event');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('event_title').setLabel('Event Title').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('event_description').setLabel('Event Description').setStyle(TextInputStyle.Paragraph).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('event_time').setLabel('Event Time').setPlaceholder('4pm').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('event_timezone').setLabel('Timezone').setPlaceholder('HST').setValue('HST').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('event_location').setLabel('Location').setStyle(TextInputStyle.Short).setRequired(false))
  );
  return modal;
}

function pollSetupModal(draft) {
  const modal = new ModalBuilder().setCustomId('poll_setup').setTitle('Poll Setup');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_question').setLabel('Poll Question').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(draft.poll.question || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_count').setLabel('Number of Answers (2-10)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(draft.poll.answerCount))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_duration').setLabel('Duration in Hours').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(draft.poll.duration))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_multiple').setLabel('Multiple Answers? YES or NO').setStyle(TextInputStyle.Short).setRequired(true).setValue(draft.poll.multiple ? 'YES' : 'NO'))
  );
  return modal;
}

function pollAnswersModal(draft, page) {
  const start = page === 1 ? 0 : 5;
  const end = Math.min(start + 5, draft.poll.answerCount);
  const modal = new ModalBuilder().setCustomId(`poll_answers_${page}`).setTitle(page === 1 ? 'Poll Answers 1-5' : 'Poll Answers 6-10');

  for (let i = start; i < end; i++) {
    const input = new TextInputBuilder().setCustomId(`poll_answer_${i}`).setLabel(`Answer ${i + 1}`).setStyle(TextInputStyle.Short).setRequired(true);
    if (draft.poll.answers[i]) input.setValue(draft.poll.answers[i]);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

// =====================================================
// NEW SCROLLING SCHEDULE PICKER
// =====================================================

function ensureSchedulePicker(draft) {
  if (!draft.schedule) draft.schedule = {};
  if (!draft.schedule.picker) {
    draft.schedule.picker = {
      year: null, month: null, day: null,
      hour: null, minute: null, ampm: null,
    };
  }
  if (!draft.schedule.timezone) draft.schedule.timezone = 'HST';
  if (!draft.schedule.flashPing) draft.schedule.flashPing = 'ROLE';
}

function scheduleYearRow() {
  const year = DateTime.now().year;
  const options = [];
  for (let y = year; y <= year + 4; y++) {
    options.push({ label: String(y), value: String(y), description: `Schedule during ${y}` });
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('schedule_year').setPlaceholder('📅 Select year').addOptions(options)
  );
}

function scheduleMonthRow() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('schedule_month')
      .setPlaceholder('📅 Select month')
      .addOptions(months.map((name, index) => ({ label: name, value: String(index + 1) })))
  );
}

function scheduleDayRows(year, month) {
  const days = DateTime.local(year, month, 1).daysInMonth;
  const first = [];
  const second = [];

  for (let day = 1; day <= days; day++) {
    const date = DateTime.local(year, month, day);
    const option = {
      label: `${date.toFormat('ccc')} ${date.toFormat('MMM')} ${day}`,
      value: String(day),
      description: date.toFormat('MMMM d, yyyy'),
    };
    if (day <= 25) first.push(option);
    else second.push(option);
  }

  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('schedule_day_1').setPlaceholder('📆 Select day').addOptions(first)
    ),
  ];

  if (second.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('schedule_day_2').setPlaceholder('📆 Days 26-31').addOptions(second)
    ));
  }

  return rows;
}

function buildTimeOptions(startHour, endHour) {
  const options = [];

  // 30-minute choices keep each Discord menu below the 25-option limit.
  // Page 1 = 12:00 AM through 11:30 AM
  // Page 2 = 12:00 PM through 11:30 PM
  for (let hour24 = startHour; hour24 <= endHour; hour24++) {
    for (const minute of [0, 30]) {
      const ampm = hour24 < 12 ? 'AM' : 'PM';
      const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
      const label = `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;

      options.push({
        label,
        value: `${hour12}|${minute}|${ampm}`,
        description: `Schedule for ${label}`,
      });
    }
  }

  return options;
}

function scheduleTimeRow1() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('schedule_time_1')
      .setPlaceholder('🕒 Select time — 12:00 AM to 11:30 AM')
      .addOptions(buildTimeOptions(0, 11))
  );
}

function scheduleTimeRow2() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('schedule_time_2')
      .setPlaceholder('🕒 Select time — 12:00 PM to 11:30 PM')
      .addOptions(buildTimeOptions(12, 23))
  );
}

function scheduleTimeRows() {
  return [
    scheduleTimeRow1(),
    scheduleTimeRow2(),
  ];
}

function scheduleTimezoneRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('schedule_timezone_select')
      .setPlaceholder('🌎 Where is this time from?')
      .addOptions(
        { label: 'Hawaii Time', value: 'HST', emoji: '🌺', description: 'Pacific/Honolulu' },
        { label: 'Pacific Time', value: 'PACIFIC', description: 'Los Angeles / West Coast' },
        { label: 'Mountain Time', value: 'MOUNTAIN', description: 'Denver / Mountain region' },
        { label: 'Central Time', value: 'CENTRAL', description: 'Chicago / Central region' },
        { label: 'Eastern Time', value: 'EASTERN', description: 'New York / East Coast' },
        { label: 'UTC / GMT', value: 'UTC', description: 'Coordinated Universal Time' }
      )
  );
}

function schedulePingRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('schedule_ping_select')
      .setPlaceholder('🔔 Select Flash warning ping')
      .addOptions(
        {
          label: 'Flash Announcements Role',
          value: 'ROLE',
          emoji: '⚡',
          description: 'Ping only people with the Flash Announcements role',
        },
        {
          label: 'Everyone',
          value: 'EVERYONE',
          emoji: '📢',
          description: 'Ping @everyone for the scheduled warning',
        }
      )
  );
}

function scheduleConfirmRows(draft) {
  ensureSchedulePicker(draft);
  const p = draft.schedule.picker;
  const date = DateTime.local(Number(p.year), Number(p.month), Number(p.day));
  const displayTime = `${p.hour}:${String(p.minute).padStart(2, '0')} ${p.ampm}`;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('schedule_confirm')
        .setLabel('Confirm Schedule')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('schedule_restart')
        .setLabel('Change Date/Time')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('cancel_draft')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function scheduleSummaryEmbed(draft) {
  ensureSchedulePicker(draft);
  const p = draft.schedule.picker;
  const converted = makeSchedulePickerTimestamp(draft);

  return new EmbedBuilder()
    .setTitle('🕒 Confirm Scheduled Announcement')
    .setDescription([
      converted ? `**Date & Time:** <t:${converted.timestamp}:F>` : '**Date & Time:** Not complete',
      converted ? `**Starts:** <t:${converted.timestamp}:R>` : '',
      '',
      `🌎 **Timezone:** ${draft.schedule.timezone}`,
      `🔔 **Flash warning:** ${draft.schedule.flashPing === 'EVERYONE' ? '@everyone' : '@Flash Announcements'}`,
      '',
      'Press **Confirm Schedule** when everything looks correct.',
    ].filter(Boolean).join('\n'));
}

function makeSchedulePickerTimestamp(draft) {
  ensureSchedulePicker(draft);
  const p = draft.schedule.picker;

  if (
    p.year == null || p.month == null || p.day == null ||
    p.hour == null || p.minute == null || !p.ampm
  ) return null;

  let hour24 = Number(p.hour);
  if (p.ampm === 'AM' && hour24 === 12) hour24 = 0;
  if (p.ampm === 'PM' && hour24 !== 12) hour24 += 12;

  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const time = `${String(hour24).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;

  return makeDiscordTimestamp(date, time, draft.schedule.timezone);
}

async function beginSchedulePicker(interaction, draft) {
  ensureSchedulePicker(draft);
  draft.schedule.picker = {
    year: null, month: null, day: null,
    hour: null, minute: null, ampm: null,
  };
  drafts.set(interaction.user.id, draft);

  return interaction.update({
    content: '## 🕒 Schedule Content\n\n**Step 1:** Select the year.',
    embeds: [],
    components: [scheduleYearRow()],
  });
}

function eventEmbed(event) {
  const embed = new EmbedBuilder()
    .setTitle(`📅 ${event.title}`)
    .setDescription(event.description)
    .addFields(
      { name: '🕒 Event Time', value: `<t:${event.timestamp}:F>` },
      { name: '⏳ Starts', value: `<t:${event.timestamp}:R>` }
    );
  if (event.location) embed.addFields({ name: '📍 Location', value: event.location });
  return embed;
}

function pollPreview(draft) {
  return new EmbedBuilder()
    .setTitle('📊 Poll Preview')
    .setDescription([
      `**${draft.poll.question}**`,
      '',
      ...draft.poll.answers.slice(0, draft.poll.answerCount).map((answer, index) => `${index + 1}. ${answer || '*Missing*'}`),
    ].join('\n'));
}

function announcementEmbed(draft, eventLinks = [], pollURL = '') {
  const fallbackDate = draft.events?.[0]?.date || draft.schedule?.date || null;
  const embed = new EmbedBuilder()
    .setTitle(draft.announcement.title)
    .setDescription(convertTimesInText(draft.announcement.description, fallbackDate))
    .setTimestamp();

  if (draft.announcement.extra) {
    embed.addFields({
      name: 'ℹ️ Additional Information',
      value: convertTimesInText(draft.announcement.extra, fallbackDate),
    });
  }

  for (const event of eventLinks) {
    embed.addFields({ name: `📅 ${event.title}`, value: `[View Event](${event.url})` });
  }

  if (pollURL) embed.addFields({ name: '📊 Poll', value: `[Open Poll](${pollURL})` });

  if (draft.announcement.image && /^https?:\/\//i.test(draft.announcement.image)) {
    embed.setImage(draft.announcement.image);
  }

  return embed;
}

function flashEmbed(draft) {
  const embed = new EmbedBuilder()
    .setDescription(convertTimesInText(draft.announcement.description, null))
    .setTimestamp();

  if (draft.announcement.extra) {
    embed.addFields({
      name: 'ℹ️ Additional Information',
      value: convertTimesInText(draft.announcement.extra, null),
    });
  }

  if (draft.announcement.image && /^https?:\/\//i.test(draft.announcement.image)) {
    embed.setImage(draft.announcement.image);
  }
  return embed;
}

async function showWizard(interaction, draft) {
  const ready = draftReady(draft);
  const status = [];

  if (hasAnnouncement(draft.type)) {
    status.push(
      draft.announcement.completed
        ? (draft.type === 'flash' ? '✅ Flash Announcement complete' : '✅ Announcement complete')
        : (draft.type === 'flash' ? '❌ Flash Announcement needed' : '❌ Announcement needed')
    );
  }

  if (hasEvents(draft.type)) status.push(draft.events.length ? `✅ ${draft.events.length} event(s)` : '❌ Event needed');

  if (hasPoll(draft.type)) {
    status.push(draft.poll.setupCompleted ? '✅ Poll setup complete' : '❌ Poll setup needed');
    status.push(draft.poll.answersCompleted ? '✅ Poll answers complete' : '❌ Poll answers needed');
  }

  const embeds = [
    new EmbedBuilder()
      .setTitle('🛠️ Content Creation')
      .setDescription([...status, '', ready ? '✅ Ready.' : 'Finish the missing sections.'].join('\n')),
  ];

  if (hasAnnouncement(draft.type) && draft.announcement.completed) {
    embeds.push(draft.type === 'flash' ? flashEmbed(draft) : announcementEmbed(draft));
  }

  for (const event of draft.events.slice(0, 5)) embeds.push(eventEmbed(event));
  if (hasPoll(draft.type) && draft.poll.setupCompleted) embeds.push(pollPreview(draft));

  const components = [];
  const creationButtons = [];

  if (hasAnnouncement(draft.type)) {
    creationButtons.push(
      new ButtonBuilder()
        .setCustomId('edit_announcement')
        .setLabel(draft.type === 'flash' ? (draft.announcement.completed ? 'Edit Flash' : 'Create Flash') : (draft.announcement.completed ? 'Edit Announcement' : 'Create Announcement'))
        .setEmoji(draft.type === 'flash' ? '⚡' : '📢')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (hasEvents(draft.type)) {
    creationButtons.push(new ButtonBuilder().setCustomId('add_event').setLabel('Add Event').setEmoji('📅').setStyle(ButtonStyle.Primary));
  }

  if (hasPoll(draft.type)) {
    creationButtons.push(
      new ButtonBuilder().setCustomId('edit_poll').setLabel(draft.poll.setupCompleted ? 'Edit Poll' : 'Create Poll').setEmoji('📊').setStyle(ButtonStyle.Secondary)
    );
  }

  if (creationButtons.length) components.push(new ActionRowBuilder().addComponents(creationButtons));

  if (draft.poll.setupCompleted) {
    const answerButtons = [
      new ButtonBuilder().setCustomId('poll_answers_1_button').setLabel(draft.poll.answerCount <= 5 ? 'Poll Answers' : 'Answers 1-5').setStyle(ButtonStyle.Secondary),
    ];
    if (draft.poll.answerCount > 5) {
      answerButtons.push(new ButtonBuilder().setCustomId('poll_answers_2_button').setLabel('Answers 6-10').setStyle(ButtonStyle.Secondary));
    }
    components.push(new ActionRowBuilder().addComponents(answerButtons));
  }

  const finalButtons = [
    new ButtonBuilder().setCustomId('post_now').setLabel('Post Now').setEmoji('🚀').setStyle(ButtonStyle.Success).setDisabled(!ready),
  ];

  if (draft.type !== 'flash') {
    finalButtons.push(
      new ButtonBuilder().setCustomId('schedule_content').setLabel('Schedule').setEmoji('🕒').setStyle(ButtonStyle.Primary).setDisabled(!ready)
    );
  }

  finalButtons.push(new ButtonBuilder().setCustomId('cancel_draft').setLabel('Cancel').setStyle(ButtonStyle.Danger));
  components.push(new ActionRowBuilder().addComponents(finalButtons));

  const payload = {
    content: '**KIND SMP Content Creator**',
    embeds,
    components,
    ephemeral: true,
  };

  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function buildPollObject(draft) {
  return {
    question: { text: draft.poll.question.slice(0, 300) },
    answers: draft.poll.answers.slice(0, draft.poll.answerCount).map(answer => ({ text: answer.slice(0, 55) })),
    duration: Math.max(1, Math.min(768, Number(draft.poll.duration) || 24)),
    allowMultiselect: draft.poll.multiple,
  };
}

async function postEvents(draft) {
  const channel = await client.channels.fetch(EVENTS_CHANNEL_ID);
  const links = [];

  for (const event of draft.events) {
    const message = await channel.send({
      content: `<@&${EVENT_ROLE_ID}>`,
      embeds: [eventEmbed(event)],
      allowedMentions: { roles: [EVENT_ROLE_ID] },
    });
    links.push({ title: event.title, url: message.url });
  }
  return links;
}

async function postPoll(draft) {
  const channel = await client.channels.fetch(POLLS_CHANNEL_ID);
  const message = await channel.send({
    content: `<@&${POLL_ROLE_ID}>`,
    poll: buildPollObject(draft),
    allowedMentions: { roles: [POLL_ROLE_ID] },
  });
  return message.url;
}

async function postFlash(draft) {
  const channel = await client.channels.fetch(FLASH_CHANNEL_ID);
  const pingEveryone = draft.announcement.pingEveryone === true;
  const content = pingEveryone ? '@everyone' : `<@&${FLASH_ROLE_ID}>`;
  const allowedMentions = pingEveryone
    ? { parse: ['everyone', 'users'] }
    : { parse: ['users'], roles: [FLASH_ROLE_ID] };

  const message = await channel.send({
    content,
    embeds: [flashEmbed(draft)],
    allowedMentions,
  });

  return { announcementURL: message.url, eventLinks: [], pollURL: '' };
}

async function postDraft(draft) {
  const result = { announcementURL: '', eventLinks: [], pollURL: '' };

  if (draft.type === 'flash') return postFlash(draft);
  if (draft.type === 'event') {
    result.eventLinks = await postEvents(draft);
    return result;
  }
  if (draft.type === 'poll') {
    result.pollURL = await postPoll(draft);
    return result;
  }

  if (hasEvents(draft.type)) result.eventLinks = await postEvents(draft);
  if (hasPoll(draft.type)) result.pollURL = await postPoll(draft);

  const announcements = await client.channels.fetch(ANNOUNCEMENTS_CHANNEL_ID);
  const mainMessage = await announcements.send({
    content: draft.announcement.pingEveryone ? '@everyone' : undefined,
    embeds: [announcementEmbed(draft, result.eventLinks, result.pollURL)],
    allowedMentions: {
      parse: draft.announcement.pingEveryone ? ['everyone', 'users'] : ['users'],
    },
  });

  result.announcementURL = mainMessage.url;

  if (hasEvents(draft.type)) {
    for (const event of draft.events) {
      await announcements.send({ embeds: [eventEmbed(event)], allowedMentions: { parse: [] } });
    }
  }

  if (hasPoll(draft.type)) {
    await announcements.send({ poll: buildPollObject(draft), allowedMentions: { parse: [] } });
  }

  return result;
}

async function sendScheduledFlashNotice(draft, edited = false) {
  let channel;
  try {
    channel = await client.channels.fetch(FLASH_CHANNEL_ID);
  } catch (error) {
    console.warn(`⚠️ Flash warning channel ${FLASH_CHANNEL_ID} could not be found. The announcement will still be scheduled.`, error?.code || error?.message || error);
    return;
  }
  if (!channel || !channel.isTextBased()) {
    console.warn(`⚠️ Flash warning channel ${FLASH_CHANNEL_ID} is unavailable or is not text-based. The announcement will still be scheduled.`);
    return;
  }
  const pingEveryone = draft.schedule?.flashPing === 'EVERYONE';
  const content = pingEveryone ? '@everyone' : `<@&${FLASH_ROLE_ID}>`;

  const embed = new EmbedBuilder()
    .setDescription([
      edited ? '**✏️ Upcoming Announcement Updated**' : '**📢 Major KIND SMP Announcement Coming Soon**',
      '',
      '🕒 **Announcement Time**',
      `<t:${draft.schedule.timestamp}:F>`,
      '',
      '⏳ **Starts**',
      `<t:${draft.schedule.timestamp}:R>`,
    ].join('\n'))
    .setFooter({ text: 'KIND SMP' });

  await channel.send({
    content,
    embeds: [embed],
    allowedMentions: pingEveryone ? { parse: ['everyone'] } : { roles: [FLASH_ROLE_ID] },
  });
}

async function sendFlashReminder(draft) {
  let channel;
  try {
    channel = await client.channels.fetch(FLASH_CHANNEL_ID);
  } catch (error) {
    console.warn(`⚠️ Flash reminder channel ${FLASH_CHANNEL_ID} could not be found. Reminder skipped.`, error?.code || error?.message || error);
    return false;
  }
  if (!channel || !channel.isTextBased()) {
    console.warn(`⚠️ Flash reminder channel ${FLASH_CHANNEL_ID} is unavailable or is not text-based. Reminder skipped.`);
    return false;
  }

  const pingEveryone = draft.schedule?.flashPing === 'EVERYONE';
  const content = pingEveryone ? '@everyone' : `<@&${FLASH_ROLE_ID}>`;
  const embed = new EmbedBuilder()
    .setTitle('⚡ MAJOR ANNOUNCEMENT UPCOMING')
    .setDescription([
      'Something important is coming to the **KIND SMP**.',
      '',
      '👀 Keep an eye on the announcements channel.',
      '',
      '🕒 **Announcement Time**',
      `<t:${draft.schedule.timestamp}:F>`,
      `<t:${draft.schedule.timestamp}:R>`,
      '',
      '*Details will be revealed when the announcement goes live.*'
    ].join('\n'))
    .setFooter({ text: 'KIND SMP • Flash Update' });

  await channel.send({
    content,
    embeds: [embed],
    allowedMentions: pingEveryone ? { parse: ['everyone'] } : { roles: [FLASH_ROLE_ID] },
  });
  return true;
}

async function sendReleasedFlashNotice(draft, result) {
  if (draft.type === 'flash') return;
  let channel;
  try {
    channel = await client.channels.fetch(FLASH_CHANNEL_ID);
  } catch (error) {
    console.warn(`⚠️ Flash warning channel ${FLASH_CHANNEL_ID} could not be found. Release notification skipped.`, error?.code || error?.message || error);
    return;
  }
  if (!channel || !channel.isTextBased()) {
    console.warn(`⚠️ Flash warning channel ${FLASH_CHANNEL_ID} is unavailable or is not text-based. Release notification skipped.`);
    return;
  }
  const embed = new EmbedBuilder().setDescription('**🚨 New KIND SMP content is now live!**');

  if (result.announcementURL) embed.addFields({ name: '📢 Announcement', value: `[View Announcement](${result.announcementURL})` });
  for (const event of result.eventLinks) embed.addFields({ name: `📅 ${event.title}`, value: `[View Event](${event.url})` });
  if (result.pollURL) embed.addFields({ name: '📊 Poll', value: `[Vote Here](${result.pollURL})` });

  await channel.send({
    content: `<@&${FLASH_ROLE_ID}>`,
    embeds: [embed],
    allowedMentions: { roles: [FLASH_ROLE_ID] },
  });
}

async function processSchedules() {
  const schedules = loadSchedules();
  const now = Math.floor(Date.now() / 1000);
  const remaining = [];

  for (const scheduled of schedules) {
    const postAt = Number(scheduled.schedule?.timestamp || 0);

    // Send a real Flash Updates reminder one hour before the scheduled post.
    // If the post was scheduled less than one hour ahead, the next scheduler
    // pass sends the reminder immediately. The flag prevents duplicates.
    if (postAt > now && !scheduled.schedule?.flashReminderSent && now >= postAt - 3600) {
      try {
        const sent = await sendFlashReminder(scheduled);
        if (sent) scheduled.schedule.flashReminderSent = true;
      } catch (error) {
        console.error('Flash reminder failed:', error);
      }
    }

    if (postAt && postAt <= now) {
      try {
        const result = await postDraft(scheduled);
        await sendReleasedFlashNotice(scheduled, result);
      } catch (error) {
        console.error('Scheduled post failed:', error);
        remaining.push(scheduled);
      }
    } else {
      remaining.push(scheduled);
    }
  }
  saveSchedules(remaining);
}

async function showScheduled(interaction) {
  const schedules = loadSchedules();
  if (schedules.length === 0) {
    return interaction.reply({ content: '📭 There are no scheduled posts.', ephemeral: true });
  }

  const options = schedules.slice(0, 25).map(item => ({
    label: (item.announcement?.title || item.events?.[0]?.title || item.poll?.question || 'Scheduled Content').slice(0, 100),
    value: item.id,
    description: item.schedule?.timestamp
      ? DateTime.fromSeconds(item.schedule.timestamp).toUTC().toFormat('MMM d yyyy HH:mm UTC')
      : 'Unknown time',
  }));

  return interaction.reply({
    content: '**🕒 Scheduled Content**',
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('scheduled_select').setPlaceholder('Choose Scheduled Content').addOptions(options)
      ),
    ],
    ephemeral: true,
  });
}

async function showScheduledItem(interaction, id) {
  const item = loadSchedules().find(schedule => schedule.id === id);
  if (!item) return interaction.update({ content: '❌ Scheduled item not found.', embeds: [], components: [] });

  const embeds = [];
  if (hasAnnouncement(item.type)) embeds.push(item.type === 'flash' ? flashEmbed(item) : announcementEmbed(item));
  for (const event of item.events || []) embeds.push(eventEmbed(event));
  if (hasPoll(item.type)) embeds.push(pollPreview(item));

  embeds.push(
    new EmbedBuilder()
      .setTitle('🕒 Scheduled Time')
      .setDescription([
        `<t:${item.schedule.timestamp}:F>`,
        `<t:${item.schedule.timestamp}:R>`,
        '',
        `Flash warning ping: **${item.schedule.flashPing || 'ROLE'}**`,
      ].join('\n'))
  );

  return interaction.update({
    content: '**Scheduled Content**',
    embeds,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`scheduled_post:${id}`).setLabel('Post Now').setEmoji('🚀').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`scheduled_edit:${id}`).setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`scheduled_cancel:${id}`).setLabel('Cancel Schedule').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      ),
    ],
  });
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log('✅ KIND SMP announcements ready.');

  try { await createDashboard(); } catch (error) { console.error('Dashboard error:', error); }
  try { await processSchedules(); } catch (error) { console.error('Schedule startup error:', error); }

  setInterval(() => {
    processSchedules().catch(console.error);
  }, 30000);
});

function isAnnouncementComponent(interaction) {
  const id = interaction.customId || '';
  // Keep this list in sync with every button/select menu created by this module.
  // If an ID is missing here Discord receives no acknowledgement and shows
  // “KIND BOSS didn't respond in time”.
  const exact = new Set([
    'create_content', 'manage_scheduled', 'scheduled_select', 'content_type',
    'edit_announcement', 'add_event', 'edit_poll',
    'calendar_year', 'calendar_month', 'calendar_day_1', 'calendar_day_2',
    'poll_answers_1_button', 'poll_answers_2_button', 'poll_duration',
    'post_now', 'schedule_content', 'cancel_draft',
    'schedule_year', 'schedule_month', 'schedule_day_1', 'schedule_day_2',
    'schedule_time_1', 'schedule_time_2', 'schedule_timezone_select',
    'schedule_ping_select', 'schedule_confirm', 'schedule_restart'
  ]);
  const prefixes = [
    'scheduled_post:', 'scheduled_cancel:', 'scheduled_edit:',
    'poll_answer_', 'poll_answers_'
  ];
  return exact.has(id) || prefixes.some((prefix) => id.startsWith(prefix));
}

function isAnnouncementModal(interaction) {
  const id = interaction.customId || '';
  return id === 'announcement_modal' || id === 'poll_setup' || id === 'poll_answer_modal' || id === 'event_modal';
}

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  // IMPORTANT: ignore buttons/selects owned by Tickets, Strikes, Venting, Staff Applications, etc.
  if (!isAnnouncementComponent(interaction)) return;

  try {
    if (!isStaff(interaction)) {
      return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'create_content') {
      return interaction.reply({
        content: '**What do you want to create?**',
        components: [contentMenu()],
        ephemeral: true,
      });
    }

    if (interaction.isButton() && interaction.customId === 'manage_scheduled') return showScheduled(interaction);

    if (interaction.isStringSelectMenu() && interaction.customId === 'scheduled_select') {
      return showScheduledItem(interaction, interaction.values[0]);
    }

    if (interaction.isButton() && interaction.customId.startsWith('scheduled_post:')) {
      const id = interaction.customId.split(':')[1];
      const item = loadSchedules().find(schedule => schedule.id === id);
      if (!item) return interaction.update({ content: '❌ Scheduled item not found.', embeds: [], components: [] });

      await interaction.deferUpdate();
      const result = await postDraft(item);
      await sendReleasedFlashNotice(item, result);
      removeSchedule(id);

      return interaction.editReply({ content: '✅ Posted successfully.', embeds: [], components: [] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('scheduled_cancel:')) {
      const id = interaction.customId.split(':')[1];
      removeSchedule(id);
      return interaction.update({ content: '🗑️ Scheduled content cancelled.', embeds: [], components: [] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('scheduled_edit:')) {
      const id = interaction.customId.split(':')[1];
      const item = loadSchedules().find(schedule => schedule.id === id);
      if (!item) return interaction.update({ content: '❌ Scheduled item not found.', embeds: [], components: [] });

      const draft = clone(item);
      draft.editingScheduledId = id;
      ensureSchedulePicker(draft);
      drafts.set(interaction.user.id, draft);
      return showWizard(interaction, draft);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'content_type') {
      const draft = createDraft(interaction.user.id, interaction.values[0]);
      return showWizard(interaction, draft);
    }

    const draft = drafts.get(interaction.user.id);
    if (!draft) {
      return interaction.reply({ content: '❌ Draft expired. Press Create Content again.', ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'edit_announcement') {
      return interaction.showModal(announcementModal(draft));
    }

    if (interaction.isButton() && interaction.customId === 'add_event') {
      draft.calendar = { year: null, month: null, selectedDate: null };
      return interaction.update({
        content: '## 📆 Event Date\n\nSelect the year.',
        embeds: [],
        components: [calendarYearRow()],
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'calendar_year') {
      draft.calendar.year = Number(interaction.values[0]);
      return interaction.update({
        content: '## 📆 Event Date\n\nSelect the month.',
        embeds: [],
        components: [calendarMonthRow()],
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'calendar_month') {
      draft.calendar.month = Number(interaction.values[0]);
      return interaction.update({
        content: '## 📆 Event Date\n\nSelect the day.',
        embeds: [],
        components: calendarDayRows(draft.calendar.year, draft.calendar.month),
      });
    }

    if (
      interaction.isStringSelectMenu() &&
      (interaction.customId === 'calendar_day_1' || interaction.customId === 'calendar_day_2')
    ) {
      draft.calendar.selectedDate = DateTime.local(
        draft.calendar.year,
        draft.calendar.month,
        Number(interaction.values[0])
      ).toFormat('yyyy-MM-dd');

      drafts.set(interaction.user.id, draft);
      return interaction.showModal(eventModal());
    }

    if (interaction.isButton() && interaction.customId === 'edit_poll') return interaction.showModal(pollSetupModal(draft));
    if (interaction.isButton() && interaction.customId === 'poll_answers_1_button') return interaction.showModal(pollAnswersModal(draft, 1));
    if (interaction.isButton() && interaction.customId === 'poll_answers_2_button') return interaction.showModal(pollAnswersModal(draft, 2));

    if (interaction.isButton() && interaction.customId === 'post_now') {
      if (!draftReady(draft)) {
        return interaction.reply({ content: '❌ Finish the required sections first.', ephemeral: true });
      }

      await interaction.deferUpdate();
      const result = await postDraft(draft);
      await sendReleasedFlashNotice(draft, result);

      if (draft.editingScheduledId) removeSchedule(draft.editingScheduledId);
      drafts.delete(interaction.user.id);

      return interaction.editReply({ content: '✅ Posted successfully.', embeds: [], components: [] });
    }

    // =================================================
    // NEW SCHEDULE SELECT MENUS
    // =================================================

    if (interaction.isButton() && interaction.customId === 'schedule_content') {
      if (!draftReady(draft)) {
        return interaction.reply({ content: '❌ Finish the required sections first.', ephemeral: true });
      }
      return beginSchedulePicker(interaction, draft);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'schedule_year') {
      ensureSchedulePicker(draft);
      draft.schedule.picker.year = Number(interaction.values[0]);
      drafts.set(interaction.user.id, draft);
      return interaction.update({
        content: `## 🕒 Schedule Content\n\n✅ Year: **${draft.schedule.picker.year}**\n\n**Step 2:** Select the month.`,
        embeds: [],
        components: [scheduleMonthRow()],
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'schedule_month') {
      draft.schedule.picker.month = Number(interaction.values[0]);
      drafts.set(interaction.user.id, draft);
      return interaction.update({
        content: `## 🕒 Schedule Content\n\n**Step 3:** Select the day.`,
        embeds: [],
        components: scheduleDayRows(draft.schedule.picker.year, draft.schedule.picker.month),
      });
    }

    if (
      interaction.isStringSelectMenu() &&
      (interaction.customId === 'schedule_day_1' || interaction.customId === 'schedule_day_2')
    ) {
      draft.schedule.picker.day = Number(interaction.values[0]);
      drafts.set(interaction.user.id, draft);

      const selected = DateTime.local(
        draft.schedule.picker.year,
        draft.schedule.picker.month,
        draft.schedule.picker.day
      );

      return interaction.update({
        content: `## 🕒 Schedule Content\n\n📅 Selected: **${selected.toFormat('cccc, MMMM d, yyyy')}**\n\n**Step 4:** Select the complete time.\n\nUse the first menu for **AM** or the second menu for **PM**.`,
        embeds: [],
        components: scheduleTimeRows(),
      });
    }

    if (
      interaction.isStringSelectMenu() &&
      (interaction.customId === 'schedule_time_1' || interaction.customId === 'schedule_time_2')
    ) {
      const [hour, minute, ampm] = interaction.values[0].split('|');

      draft.schedule.picker.hour = Number(hour);
      draft.schedule.picker.minute = Number(minute);
      draft.schedule.picker.ampm = ampm;

      drafts.set(interaction.user.id, draft);

      const selectedTime =
        `${draft.schedule.picker.hour}:${String(draft.schedule.picker.minute).padStart(2, '0')} ${draft.schedule.picker.ampm}`;

      return interaction.update({
        content: [
          '## 🕒 Schedule Content',
          '',
          `🕒 Selected time: **${selectedTime}**`,
          '',
          '**Step 5:** What timezone is that time from?',
          '',
          'Discord will convert the final scheduled time automatically for every member.',
        ].join('\n'),
        embeds: [],
        components: [scheduleTimezoneRow()],
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'schedule_timezone_select') {
      draft.schedule.timezone = interaction.values[0];
      drafts.set(interaction.user.id, draft);

      const converted = makeSchedulePickerTimestamp(draft);

      return interaction.update({
        content: [
          '## 🕒 Schedule Content',
          '',
          converted ? `🌎 Universal Discord time: <t:${converted.timestamp}:F>` : '',
          converted ? `⏳ <t:${converted.timestamp}:R>` : '',
          '',
          '**Step 6:** Who should the Flash warning ping?',
        ].filter(Boolean).join('\n'),
        embeds: [],
        components: [schedulePingRow()],
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'schedule_ping_select') {
      draft.schedule.flashPing = interaction.values[0];
      drafts.set(interaction.user.id, draft);

      const converted = makeSchedulePickerTimestamp(draft);
      if (!converted) {
        return interaction.update({
          content: '❌ I could not build that date/time. Press Schedule and try again.',
          embeds: [],
          components: [],
        });
      }

      return interaction.update({
        content: '**Final Step — Review your schedule**',
        embeds: [scheduleSummaryEmbed(draft)],
        components: scheduleConfirmRows(draft),
      });
    }

    if (interaction.isButton() && interaction.customId === 'schedule_restart') {
      return beginSchedulePicker(interaction, draft);
    }

    if (interaction.isButton() && interaction.customId === 'schedule_confirm') {
      const converted = makeSchedulePickerTimestamp(draft);

      if (!converted) {
        return interaction.reply({ content: '❌ Invalid scheduled date/time.', ephemeral: true });
      }

      const currentTime = Math.floor(Date.now() / 1000);
      if (converted.timestamp <= currentTime) {
        return interaction.reply({
          content: '❌ That time has already passed. Choose a future date/time.',
          ephemeral: true,
        });
      }

      const p = draft.schedule.picker;
      draft.schedule.enabled = true;
      draft.schedule.date = converted.normalizedDate;
      draft.schedule.time = `${p.hour}:${String(p.minute).padStart(2, '0')} ${p.ampm}`;
      draft.schedule.timestamp = converted.timestamp;
      draft.schedule.flashReminderSent = false;

      const wasEditing = Boolean(draft.editingScheduledId);
      if (wasEditing) replaceSchedule(draft.editingScheduledId, draft);
      else addSchedule(draft);

      // Do not post a Flash Updates message immediately when a schedule is
      // created or edited. processSchedules() owns the single pre-announcement
      // reminder and flashReminderSent prevents that reminder from duplicating.
      // This keeps one upcoming-announcement notification per schedule.
      drafts.delete(interaction.user.id);

      const pingText = draft.schedule.flashPing === 'EVERYONE' ? '@everyone' : '@Flash Announcements';

      return interaction.update({
        content: [
          '✅ **Content scheduled!**',
          '',
          `<t:${converted.timestamp}:F>`,
          `<t:${converted.timestamp}:R>`,
          '',
          `🌎 Timezone: **${draft.schedule.timezone}**`,
          `⚡ Flash warning notification: **${pingText}**`,
        ].join('\n'),
        embeds: [],
        components: [],
      });
    }

    if (interaction.isButton() && interaction.customId === 'cancel_draft') {
      drafts.delete(interaction.user.id);
      return interaction.update({ content: '❌ Creation cancelled.', embeds: [], components: [] });
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Something went wrong. Check Railway logs.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit()) return;
  // Do not consume modals owned by other KIND BOSS modules.
  if (!isAnnouncementModal(interaction)) return;

  try {
    const draft = drafts.get(interaction.user.id);
    if (!draft) return interaction.reply({ content: '❌ Draft expired.', ephemeral: true });

    if (interaction.customId === 'announcement_modal') {
      if (draft.type === 'flash') {
        draft.announcement.title = '';
      } else {
        draft.announcement.title = interaction.fields.getTextInputValue('announcement_title').trim();
      }

      draft.announcement.description = await convertInlineMentions(
        interaction.fields.getTextInputValue('announcement_description').trim(),
        interaction.guild
      );

      draft.announcement.extra = await convertInlineMentions(
        interaction.fields.getTextInputValue('announcement_extra').trim(),
        interaction.guild
      );

      draft.announcement.image = interaction.fields.getTextInputValue('announcement_image').trim();
      const pingInput = interaction.fields.getTextInputValue('announcement_ping').trim().toUpperCase();

      if (draft.type === 'flash') {
        if (pingInput !== 'ROLE' && pingInput !== 'EVERYONE') {
          return interaction.reply({ content: '❌ For a Flash Announcement, type **ROLE** or **EVERYONE**.', ephemeral: true });
        }
        draft.announcement.pingEveryone = pingInput === 'EVERYONE';
      } else {
        if (pingInput !== 'YES' && pingInput !== 'NO') {
          return interaction.reply({ content: '❌ Type **YES** or **NO** for @everyone.', ephemeral: true });
        }
        draft.announcement.pingEveryone = pingInput === 'YES';
      }

      draft.announcement.completed = true;
      drafts.set(interaction.user.id, draft);
      return showWizard(interaction, draft);
    }

    if (interaction.customId === 'event_modal') {
      const title = interaction.fields.getTextInputValue('event_title').trim();
      const description = await convertInlineMentions(
        interaction.fields.getTextInputValue('event_description').trim(),
        interaction.guild
      );
      const time = interaction.fields.getTextInputValue('event_time').trim();
      const timezone = interaction.fields.getTextInputValue('event_timezone').trim();
      const location = interaction.fields.getTextInputValue('event_location').trim();

      const converted = makeDiscordTimestamp(draft.calendar.selectedDate, time, timezone);
      if (!converted) return interaction.reply({ content: '❌ Invalid event date, time, or timezone.', ephemeral: true });

      draft.events.push({
        id: makeId(),
        title,
        description,
        date: converted.normalizedDate,
        time,
        timezone,
        location,
        timestamp: converted.timestamp,
      });

      drafts.set(interaction.user.id, draft);
      return showWizard(interaction, draft);
    }

    if (interaction.customId === 'poll_setup') {
      const count = Number(interaction.fields.getTextInputValue('poll_count'));
      const duration = Number(interaction.fields.getTextInputValue('poll_duration'));
      const multipleInput = interaction.fields.getTextInputValue('poll_multiple').trim().toUpperCase();

      if (!Number.isInteger(count) || count < 2 || count > 10) {
        return interaction.reply({ content: '❌ Poll answer count must be between 2 and 10.', ephemeral: true });
      }

      if (!Number.isFinite(duration) || duration < 1 || duration > 768) {
        return interaction.reply({ content: '❌ Poll duration must be between 1 and 768 hours.', ephemeral: true });
      }

      if (multipleInput !== 'YES' && multipleInput !== 'NO') {
        return interaction.reply({ content: '❌ Multiple answers must be **YES** or **NO**.', ephemeral: true });
      }

      draft.poll.question = interaction.fields.getTextInputValue('poll_question').trim();
      draft.poll.answerCount = count;
      draft.poll.duration = duration;
      draft.poll.multiple = multipleInput === 'YES';
      draft.poll.setupCompleted = true;
      draft.poll.answers = draft.poll.answers.slice(0, count);

      while (draft.poll.answers.length < count) draft.poll.answers.push('');

      draft.poll.answersCompleted = draft.poll.answers
        .slice(0, count)
        .every(answer => Boolean(answer?.trim()));

      drafts.set(interaction.user.id, draft);
      return showWizard(interaction, draft);
    }

    if (interaction.customId === 'poll_answers_1') {
      const end = Math.min(5, draft.poll.answerCount);
      for (let i = 0; i < end; i++) {
        draft.poll.answers[i] = interaction.fields.getTextInputValue(`poll_answer_${i}`).trim();
      }

      draft.poll.answersCompleted = draft.poll.answers
        .slice(0, draft.poll.answerCount)
        .every(answer => Boolean(answer?.trim()));

      drafts.set(interaction.user.id, draft);
      return showWizard(interaction, draft);
    }

    if (interaction.customId === 'poll_answers_2') {
      for (let i = 5; i < draft.poll.answerCount; i++) {
        draft.poll.answers[i] = interaction.fields.getTextInputValue(`poll_answer_${i}`).trim();
      }

      draft.poll.answersCompleted = draft.poll.answers
        .slice(0, draft.poll.answerCount)
        .every(answer => Boolean(answer?.trim()));

      drafts.set(interaction.user.id, draft);
      return showWizard(interaction, draft);
    }
  } catch (error) {
    console.error('Modal error:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Something went wrong. Check Railway logs.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN is missing.');
  process.exit(1);
}

