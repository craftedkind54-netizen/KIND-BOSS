const test = require('node:test');
const assert = require('node:assert/strict');
const { createStaffCommandEmbed } = require('../src/staffAudit');

class TestEmbedBuilder {
  setColor(color) { this.data = { color }; return this; }
  setTitle(title) { this.data.title = title; return this; }
  addFields(...fields) { this.data.fields = fields.flat(); return this; }
  setThumbnail(url) { this.data.thumbnail = { url }; return this; }
  setTimestamp() { this.data.timestamp = 'now'; return this; }
  toJSON() { return this.data; }
}

test('staff command audit includes staff, command, and staff-mode reason', () => {
  const embed = createStaffCommandEmbed(TestEmbedBuilder, {
    username: 'KindCrafted',
    uuid: '12345678-1234-1234-1234-123456789abc',
    command: '/tp Player',
    reason: 'Checking a report'
  }).toJSON();

  assert.equal(embed.title, 'Staff mode command');
  assert.deepEqual(embed.fields.map(field => field.value), ['KindCrafted', '/tp Player', 'Checking a report']);
  assert.equal(embed.thumbnail.url, 'https://mc-heads.net/avatar/12345678123412341234123456789abc/64');
});

test('staff command audit handles missing reason and rejects incomplete events', () => {
  const embed = createStaffCommandEmbed(TestEmbedBuilder, {
    username: 'Staff', uuid: 'abc', command: '/staff'
  }).toJSON();
  assert.equal(embed.fields[2].value, 'Not recorded');
  assert.throws(() => createStaffCommandEmbed(TestEmbedBuilder, { username: 'Staff', uuid: 'abc' }), /required/);
});
