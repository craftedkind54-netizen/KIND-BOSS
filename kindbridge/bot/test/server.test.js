import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../src/store.js';
import { server } from '../src/server.js';
import { config } from '../src/config.js';
import { YouTube } from '../src/youtube.js';

test('Bridge authentication, acknowledgement leases and signed WebSub callbacks',async t=>{
  const s=new Store(':memory:', {scoreboardIntegration:true}), c={...config({}),secret:'x'.repeat(48)},yt=new YouTube(s,c),http=server(s,c,yt);
  await new Promise(r=>http.listen(0,'127.0.0.1',r)); const base=`http://127.0.0.1:${http.address().port}`;
  t.after(async()=>{await new Promise(r=>http.close(r)); s.close();});
  assert.equal((await fetch(base+'/bridge/jobs')).status,401);
  const headers={authorization:`Bearer ${c.secret}`,'content-type':'application/json'};
  s.queue('test','creator',{});
  const {job}=await (await fetch(base+'/bridge/jobs',{headers})).json(); assert.ok(job.id);
  assert.equal((await fetch(base+'/bridge/ack',{method:'POST',headers,body:JSON.stringify({...job,lease:'wrong',success:true})})).status,409);
  assert.equal((await fetch(base+'/bridge/ack',{method:'POST',headers,body:JSON.stringify({...job,success:true})})).status,200);
  const channel='UC'+'a'.repeat(22),video='v'.repeat(11);
  s.run('INSERT INTO creators(user_id,channel_id,uuid,minecraft_name,data,verified_at) VALUES (?,?,?,?,?,?)','u',channel,'id','Player','{}',Date.now());
  const xml=`<feed><entry><yt:channelId>${channel}</yt:channelId><yt:videoId>${video}</yt:videoId></entry></feed>`;
  assert.equal((await fetch(base+'/youtube/websub',{method:'POST',body:xml})).status,403);
  const sig='sha1='+createHmac('sha1',c.secret).update(xml).digest('hex');
  assert.equal((await fetch(base+'/youtube/websub',{method:'POST',body:xml,headers:{'x-hub-signature':sig}})).status,200);
  assert.equal(s.one('SELECT id FROM videos').id,video);
  const q=new URLSearchParams({'hub.mode':'subscribe','hub.topic':`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`,'hub.challenge':'hello'});
  assert.equal(await (await fetch(base+'/youtube/websub?'+q)).text(),'hello');
});


test('Owner event bounties become active and ready to announce without staff approval', async t => {
  const s = new Store(':memory:', { scoreboardIntegration: true });
  const c = { ...config({}), secret: 'o'.repeat(48) }, yt = new YouTube(s, c), http = server(s, c, yt);
  await new Promise(r => http.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${http.address().port}`;
  t.after(async () => { await new Promise(r => http.close(r)); s.close(); });
  const headers = { authorization: `Bearer ${c.secret}`, 'content-type': 'application/json' };
  const payload = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    posterUuid: '12345678-1234-1234-1234-123456789012',
    posterName: 'Owner',
    targetUuid: '87654321-4321-4321-4321-210987654321',
    targetName: 'Target',
    ownerEvent: true,
    levels: 0,
    created: 1000,
    expires: 2000,
    items: Array.from({ length: 4 }, (_, i) => ({ material: 'diamond', amount: i + 1 }))
  };
  const response = await fetch(base + '/bridge/bounties', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).state, 'active');
  assert.equal(s.one('SELECT state,discord_dirty FROM bounties WHERE id=?', payload.id).state, 'active');
});
