const test = require('node:test');
const assert = require('node:assert/strict');
const discord = require('discord.js');
const setup = require('../src/supportForms');

function harness() {
  let handler;
  const client = { user: { id: 'bot' }, on: (ev, fn) => { if (ev === discord.Events.InteractionCreate) handler = fn; }, once() {} };
  const created = [];
  const forms = setup({
    client, GUILD_ID: 'g', OWNER_ROLE_ID: 'owner', CO_OWNER_ROLE_ID: 'co', STAFF_ROLE_IDS: ['staff', 'owner'], CLOSED_TICKET_LOG_CHANNEL_ID: 'log',
    createTicket: async args => { created.push(args); return { success: true, channel: { id: 't1', send: async () => {}, toString: () => '<#t1>' } }; },
    isStaff: m => m.roles.cache.has('staff'), refreshStaffCache: async () => [], getStaffRoleName: () => 'Staff',
  });
  const member = (id, roles) => ({ id, roles: { cache: new Map(roles.map(r => [r, {}])) } });
  const post = (target, type = 'complaint') => {
    const edits = [];
    const message = { embeds: [new discord.EmbedBuilder().setDescription('**Status:** 🕒 Waiting').setFooter({ text: `sf|type=${type}|user=player|target=${target}` }).toJSON()], edit: async x => edits.push(x) };
    return { message, edits };
  };
  const press = async (customId, who, message) => {
    const replies = [];
    const i = { customId, guild: { id: 'g', members: { fetch: async id => ({ id }) }, channels: { fetch: async () => null } }, member: who, user: { id: who.id },
      message, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, isUserSelectMenu: () => false,
      reply: async x => replies.push(x), followUp: async x => replies.push(x), deferReply: async () => { i.deferred = true; }, editReply: async x => replies.push(x) };
    await handler(i);
    return replies.map(r => typeof r === 'string' ? r : r.content).join('\n');
  };
  return { forms, created, member, post, press };
}

test('panel has the four support options and form inputs fit Discord limits', () => {
  const { forms } = harness();
  const ids = forms.panelRows()[0].components.map(b => b.data.custom_id);
  assert.deepEqual(ids, ['sf:new:complaint', 'sf:new:report', 'sf:new:poll', 'sf:new:question']);
  for (const fields of Object.values(setup.FIELDS)) {
    assert.ok(fields.length <= 5);
    for (const [, label, , max, , ph] of fields) { assert.ok(label.length <= 45, label); assert.ok(ph.length <= 100, ph); assert.ok(max <= 1024); }
  }
});

test('a request for a specific staff member can only be opened by them or leadership', async () => {
  const h = harness();
  const { message } = h.post('alice');
  assert.match(await h.press('sf:open', h.member('bob', ['staff']), message), /for <@alice>/);
  assert.equal(h.created.length, 0);
  await h.press('sf:open', h.member('alice', ['staff']), message);
  assert.equal(h.created.length, 1);
  assert.deepEqual(h.created[0].allowedUsers, ['alice']);
  assert.equal(h.created[0].type, 'form_complaint');
});

test('complaints about staff are leadership only; players cannot open tickets', async () => {
  const h = harness();
  const { message } = h.post('lead');
  assert.match(await h.press('sf:open', h.member('bob', ['staff']), message), /Owner or Co-Owner/);
  assert.match(await h.press('sf:open', h.member('p', []), message), /Staff only/);
  await h.press('sf:open', h.member('boss', ['owner']), message);
  assert.equal(h.created.length, 1);
});

test('opening a request marks it claimed and removes the buttons', async () => {
  const h = harness();
  const { message, edits } = h.post('any', 'report');
  await h.press('sf:open', h.member('bob', ['staff']), message);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].components, []);
  assert.match(edits[0].embeds[0].data.description, /Ticket opened by <@bob>/);
});
