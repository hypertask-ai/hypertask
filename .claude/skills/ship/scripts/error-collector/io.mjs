import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';

const deadlines = new AsyncLocalStorage();

export async function withDeadline(timeoutMs, fn) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('invalid run timeout');
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await deadlines.run({ deadline, controller, signal: controller.signal }, () => fn(controller.signal)); }
  finally { clearTimeout(timer); }
}

export function timeLeft(limit) {
  const context = deadlines.getStore();
  const remaining = context ? Math.ceil(context.deadline - performance.now()) : Infinity;
  if (remaining <= 0 || context?.signal.aborted) {
    context.controller.abort();
    throw new Error('run deadline exceeded');
  }
  return Math.min(limit, remaining);
}

export async function bounded(promise) {
  const signal = deadlines.getStore()?.signal;
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  const expired = new Promise((_, reject) => {
    abort = () => reject(new Error('run deadline exceeded'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, expired]); }
  finally { signal.removeEventListener('abort', abort); }
}

export function command(name, args, env) {
  const result = spawnSync(name, args, { env, encoding: 'utf8', timeout: timeLeft(60000), killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 });
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
    signal: AbortSignal.any([AbortSignal.timeout(timeLeft(90000)), ...(deadlines.getStore() ? [deadlines.getStore().signal] : [])]),
  });
  // Provider response bodies may contain credentials; callers only expose safe status codes.
  let data;
  try { data = await response.json(); } catch { throw new Error('invalid query response'); }
  return { status: response.status, data };
}
