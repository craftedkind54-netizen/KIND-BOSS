'use strict';
// Promotion board screen-share page. The interviewer opens the link from the
// "🔗 Screen Share Link" button and shares that browser window in the voice call.
// It shows only the question currently put on screen, with a countdown.
const http = require('http');

const TOKEN = /^[a-f0-9]{32}$/;

const PRESENTER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>KIND SMP Promotion Board</title>
<style>
:root{--bg:#0f1115;--panel:#181b22;--text:#f2f3f5;--muted:#9aa1ad;--accent:#5865f2;--ok:#3ba55d;--warn:#faa61a;--bad:#ed4245}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:"Segoe UI",system-ui,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;padding:4vh 5vw;gap:3vh}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.brand{font-weight:700;font-size:clamp(16px,2vw,26px);letter-spacing:.04em}
.chip{background:var(--panel);border-radius:999px;padding:8px 16px;color:var(--muted);font-size:clamp(13px,1.4vw,20px)}
.stage{flex:1;display:grid;grid-template-columns:1fr auto;gap:5vw;align-items:center}
.label{color:var(--muted);font-size:clamp(14px,1.6vw,24px);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2vh}
.question{font-size:clamp(26px,3.6vw,60px);line-height:1.25;font-weight:600}
.timer{position:relative;width:clamp(180px,24vw,380px);aspect-ratio:1}
.timer svg{width:100%;height:100%;transform:rotate(-90deg)}
.timer circle{fill:none;stroke-width:9}.track{stroke:var(--panel)}.ring{stroke:var(--ok);stroke-linecap:round;transition:stroke-dashoffset .25s linear,stroke .3s}
.secs{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:clamp(48px,7vw,120px);font-weight:700;font-variant-numeric:tabular-nums}
footer{display:flex;justify-content:space-between;color:var(--muted);font-size:clamp(13px,1.4vw,20px);gap:16px;flex-wrap:wrap}
.waiting .stage{grid-template-columns:1fr}.waiting .timer{display:none}
.up .secs{color:var(--bad)}
@media (max-width:700px){.stage{grid-template-columns:1fr;justify-items:center}}
</style></head><body>
<main id="m" class="waiting">
<header><div class="brand">🛡️ KIND SMP PROMOTION BOARD</div><div class="chip" id="rank">Loading…</div></header>
<section class="stage"><div><div class="label" id="label">Please wait</div><div class="question" id="q">Waiting for the interviewer…</div></div>
<div class="timer"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="ring" id="ring" cx="50" cy="50" r="44" stroke-dasharray="276.46" stroke-dashoffset="0"/></svg><div class="secs" id="secs">60</div></div></section>
<footer><span id="cat"></span><span id="rep"></span></footer>
</main>
<script>
const $=id=>document.getElementById(id),C=276.46;let st=null,skew=0;
async function poll(){try{const r=await fetch(location.pathname.replace(/\\/$/,'')+'/state',{cache:'no-store'});if(r.ok){const j=await r.json();skew=j.now-Date.now();st=j;}}catch(e){}}
function draw(){if(!st)return;$('rank').textContent=st.rank?('Applying for '+st.rank):'';
 const m=$('m');
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

function startBoardPresenter({lookup, port = Number(process.env.BOARD_PRESENTER_PORT || 3002), host = '127.0.0.1'}) {
  const server = http.createServer((req, res) => {
    const send = (code, type, body) => {
      res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'"});
      res.end(body);
    };
    const m = /^\/board\/([^/?]+)(\/state)?\/?(?:\?.*)?$/.exec(req.url || '');
    if (req.method !== 'GET' || !m || !TOKEN.test(m[1])) return send(404, 'text/plain', 'Not found');
    let st;
    try { st = lookup(m[1]); } catch (e) { console.error('[Promotion Board] screen lookup failed:', e); return send(500, 'text/plain', 'Error'); }
    if (!st) return send(404, 'text/plain', 'Not found');
    if (m[2]) return send(200, 'application/json', JSON.stringify({...st, now: Date.now()}));
    return send(200, 'text/html; charset=utf-8', PRESENTER_HTML);
  });
  server.on('error', e => console.warn('[Promotion Board] screen-share server not started:', e.message));
  server.listen(port, host, () => console.log(`[Promotion Board] screen-share page on ${host}:${port}`));
  return server;
}

module.exports = {startBoardPresenter, PRESENTER_HTML};
