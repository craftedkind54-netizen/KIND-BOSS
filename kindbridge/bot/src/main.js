import { join } from 'node:path';
import { config, validateConfig } from './config.js';
import { Store } from './store.js';
import { YouTube } from './youtube.js';
import { createDiscord } from './discord.js';
import { server } from './server.js';

export async function startKindBridge(sharedClient) {
  const c = config();
  validateConfig(c);
  const s = new Store(join(c.dataDir, 'kind-smp.db'));
  const yt = new YouTube(s, c);
  const { maintenance } = createDiscord(s, c, yt, sharedClient);
  const http = server(s, c, yt, () => sharedClient.isReady());
  http.requestTimeout = 20000;
  http.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(c.port, '0.0.0.0', resolve);
  });

  let busy = false, discordBusy = false, stopping = false;
  async function discordTick() {
    if (discordBusy || stopping || !sharedClient.isReady()) return;
    discordBusy = true;
    try { await maintenance(); }
    catch (e) { console.error('Discord maintenance:', e.message); s.set('discordError', e.message); }
    finally { discordBusy = false; }
  }
  async function tick() {
    if (busy || stopping || !sharedClient.isReady()) return;
    busy = true;
    try {
      if (c.youtubeKey) {
        for (const [name, interval, work] of [
          ['channel-links', 10000, () => yt.linkApplications()],
          ['stats', 60000, () => yt.refreshStats()], ['subscriptions', 3600000, () => yt.subscriptions()],
          ['feeds', c.pollMinutes * 60000, () => yt.feeds()], ['videos', c.livePollMinutes * 60000, () => yt.inspectVideos()]
        ]) {
          if (Date.now() - s.get(`tick:${name}`, 0) < interval) continue;
          s.set(`tick:${name}`, Date.now());
          try { await work(); yt.reportIssue(name, null); }
          catch (e) {
            s.set('youtubeError', `${name}: ${e.message}`);
            console.error(`YouTube ${name}:`, e.message);
            yt.reportIssue(name, e.message);
          }
        }
      }
    } finally { busy = false; }
  }
  const timer = setInterval(tick, 10000), discordTimer = setInterval(discordTick, 10000);
  tick(); discordTick();
  return async function stopKindBridge() {
    stopping = true;
    clearInterval(timer); clearInterval(discordTimer);
    await new Promise(resolve => http.close(resolve));
    const deadline = Date.now() + 20000;
    while ((busy || discordBusy) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    if (!busy && !discordBusy) s.close();
  };
}
