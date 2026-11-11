import { createCipheriv, createDecipheriv, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { command } from './io.mjs';

export const workflow = 'error-collector-vercel.yml';
export const artifact = 'vercel-error-feed';
const repo = 'hypertask-ai/hypertask';

export function seal(value, publicKey) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ key: publicEncrypt(publicKey, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

export function open(text, privateKey) {
  const value = JSON.parse(text);
  const decipher = createDecipheriv('aes-256-gcm', privateDecrypt(privateKey, Buffer.from(value.key, 'base64')), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString());
}

export function selectWindow(snapshot, service, since, until) {
  const batch = snapshot?.sources?.[service];
  if (snapshot?.version !== 1 || !batch || !Number.isFinite(Date.parse(batch.since)) || !Number.isFinite(Date.parse(batch.until)) || Date.parse(batch.since) > Date.parse(since) || Date.parse(batch.until) <= Date.parse(since) || Date.parse(batch.until) > Date.parse(until) || !Array.isArray(batch.events)) throw new Error('hosted Vercel coverage unavailable');
  return { events: batch.events.filter(event => Date.parse(event.ts) > Date.parse(since) && Date.parse(event.ts) <= Date.parse(batch.until)), cursor: null, until: batch.until };
}

function githubEnv(env) {
  const token = command('gh-app-token', [], env).trim();
  if (!token || /\s/.test(token)) throw new Error('github credential unavailable');
  return { ...env, GH_TOKEN: token, GITHUB_TOKEN: token };
}

let cached;
export async function fetchHosted({ since, until, env }, service) {
  if (!cached) {
    cached = Promise.resolve().then(() => {
      const github = githubEnv(env);
      const runs = JSON.parse(command('gh', ['run', 'list', '--repo', repo, '--workflow', workflow, '--branch', 'production', '--status', 'success', '--limit', '1', '--json', 'databaseId'], github));
      if (!Number.isSafeInteger(runs[0]?.databaseId)) throw new Error('no successful hosted Vercel run');
      const dir = mkdtempSync(join(tmpdir(), 'vercel-feed-'));
      try {
        command('gh', ['run', 'download', String(runs[0].databaseId), '--repo', repo, '--name', artifact, '--dir', dir], github);
        const key = readFileSync(env.ERROR_COLLECTOR_VERCEL_PRIVATE_KEY ?? join(env.HOME ?? homedir(), '.local/state/error-collector/vercel-feed.pem'));
        return open(readFileSync(join(dir, 'feed.enc'), 'utf8'), key);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
  return selectWindow(await cached, service, since, until);
}
