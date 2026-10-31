import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedEntries } from './youtube.js';
export function equalSecret(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
async function readBody(req, limit = 262144) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { const e = new Error('Body too large'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const validMinecraftName = value => typeof value === 'string' && /^[\p{L}\p{N}_. -]{1,32}$/u.test(value) && value.trim().length > 0;

export function server(store, c, youtube, ready = () => true) {
  return createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname === '/health' && req.method === 'GET') return reply(ready() ? 200 : 503, { ready: ready() });
      if (u.pathname === '/admin/migrate-kindbridge-db' && req.method === 'POST') {
        const token = process.env.KIND_BRIDGE_MIGRATION_TOKEN || '';
        if (!token || !equalSecret(req.headers.authorization, `Bearer ${token}`)) return reply(401, { error: 'Unauthorized' });
        if (store.get('kindBridgeDbImportedV1', false)) return reply(409, { error: 'Kind Bridge database was already imported' });
        const body = await readBody(req, 10 * 1024 * 1024);
        if (!body.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) return reply(400, { error: 'Expected a SQLite database snapshot' });
        const file = join(c.dataDir, `.kindbridge-import-${randomUUID()}.db`);
        try {
          writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
          const rows = store.importFrom(file);
          process.env.KIND_BRIDGE_MIGRATION_TOKEN = '';
          return reply(200, { ok: true, imported: true, rows });
        } finally { try { unlinkSync(file); } catch {} }
      }
      if (u.pathname.startsWith('/api/v1/')) {
        const upstream = httpRequest({ hostname: '127.0.0.1', port: c.strikesApiPort, path: req.url, method: req.method, headers: req.headers }, response => {
          res.writeHead(response.statusCode || 502, response.headers);
          response.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) reply(502, { error: 'Strike service unavailable' }); else res.destroy(); });
        req.pipe(upstream);
        return;
      }
      if (u.pathname.startsWith('/bridge/')) {
        if (!equalSecret(req.headers.authorization, `Bearer ${c.kindBridgeSecret || c.secret}`)) return reply(401, { error: 'Unauthorized' });
        if (u.pathname === '/bridge/bounties' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req, 200000)).toString());
          if (!/^[0-9a-f-]{36}$/i.test(body.id || '') || !/^[0-9a-f-]{36}$/i.test(body.posterUuid || '') ||
              !/^[0-9a-f-]{36}$/i.test(body.targetUuid || '') || body.posterUuid === body.targetUuid ||
              !validMinecraftName(body.posterName) || !validMinecraftName(body.targetName) ||
              !Number.isSafeInteger(body.levels) || body.levels < 0 || !Array.isArray(body.items) || body.items.length > 3 ||
              !Number.isSafeInteger(body.created) || !Number.isSafeInteger(body.expires) || body.expires <= body.created) {
            return reply(400, { error: 'Invalid bounty request' });
          }
          try { store.submitBounty(body); }
          catch (e) { return reply(409, { error: e.message }); }
          const state=store.one('SELECT state FROM bounties WHERE id=?',body.id)?.state || 'pending';
          return reply(202, { ok: true, id: body.id, state });
        }
        if (u.pathname === '/bridge/bounties/actions' && req.method === 'GET') {
          const limitValue = Number(u.searchParams.get('limit') || 20);
          if (!Number.isSafeInteger(limitValue)) return reply(400, { error: 'Invalid action limit' });
          const limit = Math.min(50, Math.max(1, limitValue));
          const actions = store.all('SELECT id,bounty_id,action,reviewer_id,created FROM bounty_actions WHERE acknowledged=0 ORDER BY id LIMIT ?', limit)
            .map(a => ({ id: a.id, bountyId: a.bounty_id, action: a.action, reviewer: a.reviewer_id, created: a.created }));
          return reply(200, { actions });
        }
        if (u.pathname === '/bridge/bounties/actions/ack' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString());
          if (!Number.isSafeInteger(body.id) || body.id < 1) return reply(400, { error: 'Invalid action id' });
          store.run('UPDATE bounty_actions SET acknowledged=1 WHERE id=?', body.id);
          return reply(200, { ok: true });
        }
        if (u.pathname === '/bridge/bounties/update' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req, 200000)).toString());
          if (!/^[0-9a-f-]{36}$/i.test(body.id || '') || !['active','claimed','expired','refunded','rejected','cancelled'].includes(body.state)) {
            return reply(400, { error: 'Invalid bounty update' });
          }
          const row = store.one('SELECT id,state FROM bounties WHERE id=?', body.id);
          if (!row) return reply(404, { error: 'Unknown bounty' });
          const transitions = { pending: ['active','cancelled'], approved: ['active','rejected','cancelled'], active: ['claimed','expired','refunded','cancelled'], claimed: ['claimed'], expired: ['expired'], refunded: ['refunded'], rejected: ['rejected'], cancelled: ['cancelled'] };
          if (!transitions[row.state]?.includes(body.state)) return reply(409, { error: `Invalid bounty transition ${row.state} -> ${body.state}` });
          const previous=JSON.parse(store.one('SELECT result FROM bounties WHERE id=?',body.id).result || '{}');
          store.run('UPDATE bounties SET state=?,result=?,discord_dirty=1 WHERE id=?', body.state, JSON.stringify({...previous,...body}), body.id);
          return reply(200, { ok: true });
        }
        if (u.pathname === '/bridge/jobs' && req.method === 'GET') { store.set('bridgeSeen', Date.now()); return reply(200, { job: store.lease() }); }
        if (u.pathname === '/bridge/ack' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString());
          if (typeof body.id !== 'string' || typeof body.lease !== 'string' || typeof body.success !== 'boolean') return reply(400, { error: 'Invalid acknowledgement' });
          if (!store.ack(body.id, body.lease, body.success, body.result || {}, body.error || '')) return reply(409, { error: 'Lease expired' });
          return reply(200, { ok: true });
        }
        return reply(404, { error: 'Not found' });
      }
      if (u.pathname === '/youtube/websub' && req.method === 'GET') {
        const topic = u.searchParams.get('hub.topic') || '';
        const match = /^https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})$/.exec(topic);
        if (u.searchParams.get('hub.mode') !== 'subscribe' || !match || !store.one('SELECT user_id FROM creators WHERE channel_id=?', match[1])) return reply(403, { error: 'Unknown subscription' });
        const challenge = u.searchParams.get('hub.challenge') || '';
        if (challenge.length > 500) return reply(400, { error: 'Invalid challenge' });
        res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(challenge);
      }
      if (u.pathname === '/youtube/websub' && req.method === 'POST') {
        const body = await readBody(req);
        const signature = req.headers['x-hub-signature'] || '';
        const expected = `sha1=${createHmac('sha1', c.kindBridgeSecret || c.secret).update(body).digest('hex')}`;
        if (!equalSecret(signature, expected)) return reply(403, { error: 'Bad signature' });
        youtube.ingest(feedEntries(body.toString()), true);
        return reply(200, { ok: true });
      }
      reply(404, { error: 'Not found' });
    } catch (e) { reply(e.status || 400, { error: 'Request could not be processed' }); }
  });
}
