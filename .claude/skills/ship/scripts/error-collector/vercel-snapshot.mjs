import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fetchVercel } from './sources/vercel.mjs';
import { withDeadline } from './io.mjs';
import { seal } from './vercel-hosted.mjs';

await withDeadline(12 * 60 * 1000, async () => {
  const until = new Date().toISOString();
  const since = new Date(Date.parse(until) - 24 * 60 * 60 * 1000).toISOString();
  const sources = {};
  for (const service of ['vercel', 'vercel-5xx', 'realtime']) {
    try {
      const events = await fetchVercel({ since, until, env: process.env }, service);
      sources[service] = { since, until, events };
      console.log(`${service}: ${events.length} events`);
    } catch { console.error(`${service}: fetch failed; no coverage published`); }
  }
  if (!Object.keys(sources).length) throw new Error('all Vercel sources failed');
  const publicKey = readFileSync(new URL('./vercel-feed.pub.pem', import.meta.url));
  mkdirSync('vercel-feed', { recursive: true, mode: 0o700 });
  writeFileSync('vercel-feed/feed.enc', seal({ version: 1, sources }, publicKey), { mode: 0o600 });
}).catch(() => { console.error('Vercel snapshot failed; response bodies not logged'); process.exitCode = 1; });
