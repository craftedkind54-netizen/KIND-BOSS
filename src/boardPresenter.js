'use strict';
// Promotion board question screen with a countdown.
//  - Discord Activity: started from the 🚀 button inside the interview voice call.
//    Discord loads https://<app-id>.discordsays.com/?channel_id=…&frame_id=…, which
//    the Developer Portal URL mapping sends to /activity/ on this server.
//  - Browser fallback: /board/<token> from the "Screen Share Link" button.
// Both only show the question the interviewer put on screen.
const http = require('http');

const TOKEN = /^[a-f0-9]{32}$/;
const SNOWFLAKE = /^\d{17,20}$/;

const PRESENTER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>KIND SMP Promotion Board</title>
<style>
:root{--bg:#0f1115;--panel:#181b22;--text:#f2f3f5;--muted:#9aa1ad;--ok:#3ba55d;--warn:#faa61a;--bad:#ed4245}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:"Segoe UI",system-ui,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;padding:4vh 5vw;gap:3vh}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.brand{font-weight:700;font-size:clamp(14px,2vw,26px);letter-spacing:.04em}
.chip{background:var(--panel);border-radius:999px;padding:8px 16px;color:var(--muted);font-size:clamp(12px,1.4vw,20px)}
.stage{flex:1;display:grid;grid-template-columns:1fr auto;gap:5vw;align-items:center}
.label{color:var(--muted);font-size:clamp(13px,1.6vw,24px);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2vh}
.question{font-size:clamp(20px,3.6vw,60px);line-height:1.25;font-weight:600}
.timer{position:relative;width:clamp(140px,24vw,380px);aspect-ratio:1}
.timer svg{width:100%;height:100%;transform:rotate(-90deg)}
.timer circle{fill:none;stroke-width:9}.track{stroke:var(--panel)}.ring{stroke:var(--ok);stroke-linecap:round;transition:stroke-dashoffset .25s linear,stroke .3s}
.secs{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:clamp(40px,7vw,120px);font-weight:700;font-variant-numeric:tabular-nums}
footer{display:flex;justify-content:space-between;color:var(--muted);font-size:clamp(12px,1.4vw,20px);gap:16px;flex-wrap:wrap}
.waiting .stage{grid-template-columns:1fr}.waiting .timer{display:none}
.up .secs{color:var(--bad)}
@media (max-width:700px){.stage{grid-template-columns:1fr;justify-items:center}}
</style></head><body>
<main id="m" class="waiting">
<header><div class="brand">🛡️ KIND SMP PROMOTION BOARD</div><div class="chip" id="rank">Loading…</div></header>
<section class="stage"><div><div class="label" id="label">Please wait</div><div class="question" id="q">Connecting…</div></div>
<div class="timer"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="ring" id="ring" cx="50" cy="50" r="44" stroke-dasharray="276.46" stroke-dashoffset="0"/></svg><div class="secs" id="secs">60</div></div></section>
<footer><span id="cat"></span><span id="rep"></span></footer>
</main>
<script>
const CLIENT_ID=__CLIENT_ID__;
const $=id=>document.getElementById(id),C=276.46,P=new URLSearchParams(location.search);let st=null,skew=0,missing=false;
const inBoard=/\\/board\\/[a-f0-9]{32}/.test(location.pathname);
const stateUrl=inBoard?location.pathname.replace(/\\/$/,'')+'/state':'state?channel_id='+encodeURIComponent(P.get('channel_id')||'');
// Discord Activity handshake (opcode 0) so the client shows the app in the call.
if(!inBoard&&P.get('frame_id')&&window.parent!==window){try{window.parent.postMessage([0,{v:1,encoding:'json',client_id:CLIENT_ID,frame_id:P.get('frame_id')}],'*');}catch(e){}}
async function poll(){try{const r=await fetch(stateUrl,{cache:'no-store'});if(r.ok){const j=await r.json();skew=j.now-Date.now();st=j;missing=false;}else if(r.status===404){missing=true;}}catch(e){}}
function draw(){
 const m=$('m');
 if(missing&&!st){m.className='waiting';$('rank').textContent='';$('label').textContent='No interview here';$('q').textContent='Open this Activity from a KIND BOSS interview voice channel.';return;}
 if(!st)return;$('rank').textContent=st.rank?('Applying for '+st.rank):'';
 if(st.phase!=='question'){m.className='waiting';$('label').textContent=st.phase==='ended'?'Interview complete':'Please wait';
  $('q').textContent=st.phase==='ended'?'Thank you. This board has finished.':st.phase==='brief'?'The interviewer is reading the category brief…':'Waiting for the next question…';
  $('cat').textContent=st.category?(st.category+' — Category '+st.categoryNumber+'/'+st.categoryCount):'';$('rep').textContent='';return;}
 const left=Math.max(0,st.seconds*1000-(Date.now()+skew-st.startedAt)),s=Math.ceil(left/1000),f=left/(st.seconds*1000);
 m.className=left<=0?'up':'';$('label').textContent='Question '+st.number+' of '+st.of;$('q').textContent=st.question;
 $('secs').textContent=left<=0?'0':String(s);$('ring').style.strokeDashoffset=String(C*(1-f));
 $('ring').style.stroke=f>.5?'var(--ok)':f>.2?'var(--warn)':'var(--bad)';
 $('cat').textContent=st.category+' — Category '+st.categoryNumber+'/'+st.categoryCount;
 $('rep').textContent=left<=0?"⏰ Time's up":'🔁 Repeats used: '+st.repeats+'/'+st.maxRepeats;}
poll();setInterval(poll,1000);setInterval(draw,200);
</script></body></html>`;

function pageFor(clientId) {
  return PRESENTER_HTML.replace('__CLIENT_ID__', JSON.stringify(SNOWFLAKE.test(String(clientId || '')) ? String(clientId) : ''));
}

function startBoardPresenter({lookup, lookupChannel = () => null, clientId = () => '', port = Number(process.env.BOARD_PRESENTER_PORT || 3002), host = '127.0.0.1'}) {
  const server = http.createServer((req, res) => {
    const send = (code, type, body, extra = {}) => {
      res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'", ...extra});
      res.end(body);
    };
    if (req.method !== 'GET') return send(404, 'text/plain', 'Not found');
    const u = new URL(req.url || '/', 'http://local');
    const json = st => send(200, 'application/json', JSON.stringify({...st, now: Date.now()}));
    const safe = fn => { try { return fn(); } catch (e) { console.error('[Promotion Board] screen lookup failed:', e); return undefined; } };
    // Discord Activity
    if (u.pathname === '/activity') return send(301, 'text/plain', 'Moved', {Location: '/activity/' + u.search});
    if (u.pathname === '/activity/') return send(200, 'text/html; charset=utf-8', pageFor(clientId()));
    if (u.pathname === '/activity/state') {
      const ch = u.searchParams.get('channel_id') || '';
      if (!SNOWFLAKE.test(ch)) return send(404, 'text/plain', 'Not found');
      const st = safe(() => lookupChannel(ch));
      if (st === undefined) return send(500, 'text/plain', 'Error');
      return st ? json(st) : send(404, 'text/plain', 'Not found');
    }
    // Browser fallback
    const m = /^\/board\/([^/]+)(\/state)?\/?$/.exec(u.pathname);
    if (!m || !TOKEN.test(m[1])) return send(404, 'text/plain', 'Not found');
    const st = safe(() => lookup(m[1]));
    if (st === undefined) return send(500, 'text/plain', 'Error');
    if (!st) return send(404, 'text/plain', 'Not found');
    if (m[2]) return json(st);
    return send(200, 'text/html; charset=utf-8', pageFor(clientId()));
  });
  server.on('error', e => console.warn('[Promotion Board] screen server not started:', e.message));
  server.listen(port, host, () => console.log(`[Promotion Board] screen on ${host}:${port}`));
  return server;
}

module.exports = {startBoardPresenter, PRESENTER_HTML, pageFor};
