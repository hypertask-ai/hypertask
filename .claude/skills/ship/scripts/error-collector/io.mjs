import { spawnSync } from 'node:child_process';

export function command(name, args, env) {
  const result = spawnSync(name, args, { env, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${name} read failed`);
  return result.stdout;
}

export function key(service, variable, env) {
  const value = command('stack-key', [service, variable], env).trim();
  if (!value) throw new Error('credential unavailable');
  return value;
}

export async function query(url, token, body, headers = {}) {
  const response = await globalThis.fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90000),
  });
  // Provider response bodies may contain credentials; callers only expose safe status codes.
  let data;
  try { data = await response.json(); } catch { throw new Error('invalid query response'); }
  return { status: response.status, data };
}
