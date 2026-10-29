import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export class GithubRateLimit extends Error {
  constructor(until) {
    super(`skipped: GitHub rate limited until ${until}; the next push or pull request event reconciles again`);
    this.rateLimited = true;
  }
}

export function rateLimitWait(status, headers, body, now = Date.now()) {
  const get = (key) => headers.get(key);
  if (![403, 429].includes(status) || !(status === 429 || get('x-ratelimit-remaining') === '0' ||
    get('retry-after') != null || /rate limit/i.test(body))) return null;
  const waits = [];
  const reset = get('x-ratelimit-reset');
  if (/^\d+$/.test(reset)) waits.push(Number(reset) * 1000 - now);
  const retry = get('retry-after');
  if (/^\d+$/.test(retry)) waits.push(Number(retry) * 1000);
  else if (retry && Number.isFinite(Date.parse(retry))) waits.push(Date.parse(retry) - now);
  // Secondary limits may omit both headers; GitHub recommends at least a minute.
  return Math.max(1000, ...(waits.length ? waits : [60000]));
}

export function createRateLimitBudget({ now = Date.now, maxWaitMs = 240000, timeBudgetMs = 480000, state } = {}) {
  const budget = state ?? { waited: 0, deadline: now() + timeBudgetMs };
  return {
    state: budget,
    reserve(wait) {
      const until = new Date(now() + wait).toISOString();
      if (budget.waited + wait > maxWaitMs || now() + wait + 30000 > budget.deadline) {
        throw new GithubRateLimit(until);
      }
      budget.waited += wait;
      return wait;
    },
  };
}

export function parseGhResponse(output) {
  let status = 0;
  let headers = new Map();
  const body = output.replace(/(?<=^|[[\]{},\n])HTTP\/[\d.]+ (\d{3})[^\r\n]*\r?\n((?:[^\r\n]+\r?\n)*)\r?\n/g, (_, code, lines) => {
    status = Number(code);
    headers = new Map(lines.trim().split(/\r?\n/).map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    }));
    return '';
  });
  return { status, headers, body };
}

export async function ghApi(args, { exec = spawnSync, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now, budget = createRateLimitBudget({ now }), save = () => {}, log = console.error, env = process.env } = {}) {
  const readOnly = !args.some((arg, index) => {
    if (arg === '-X' || arg === '--method') return args[index + 1]?.toUpperCase() !== 'GET';
    if (arg.startsWith('-X')) return arg.slice(2).toUpperCase() !== 'GET';
    if (arg.startsWith('--method=')) return arg.slice(9).toUpperCase() !== 'GET';
    return /^(--input(?:=|$)|--(?:raw-)?field(?:=|$)|-[fF])/.test(arg);
  });
  let readToken = readOnly ? env.GH_READ_TOKEN || '' : '';
  for (;;) {
    const response = exec('gh', ['api', '--include', ...args], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024,
      ...(readToken ? { env: { ...process.env, GH_TOKEN: readToken } } : {}),
    });
    const parsed = parseGhResponse(response.stdout || '');
    if (response.status === 0) return parsed.body;
    if (readToken) {
      readToken = '';
      log('hypertask-ci read token failed; retrying with GH_TOKEN');
      continue;
    }
    const status = parsed.status || Number(/HTTP (\d{3})/.exec(response.stderr || '')?.[1]);
    const wait = rateLimitWait(status, parsed.headers, parsed.body + (response.stderr || ''), now());
    if (wait == null) throw new Error(`GitHub API returned HTTP ${status || 'unknown'}`);
    if (!readOnly || env.GH_API_NO_WAIT === '1') throw new GithubRateLimit(new Date(now() + wait).toISOString());
    const ms = budget.reserve(wait);
    save(budget.state);
    log(`GitHub API rate limited; waiting ${Math.ceil(ms / 1000)}s until reset`);
    await sleep(ms);
  }
}

export async function retryGithubRequest(request, {
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.error, budget = createRateLimitBudget({ now, maxWaitMs: 3600000, timeBudgetMs: 3660000 }),
} = {}) {
  for (;;) {
    try {
      return await request();
    } catch (error) {
      const headers = new Map(Object.entries(error.response?.headers ?? {}).map(([key, value]) =>
        [key.toLowerCase(), String(value)]));
      const wait = rateLimitWait(error.status, headers, error.message, now());
      if (wait == null) throw error;
      const ms = budget.reserve(wait);
      log(`GitHub rate limited; retrying after ${Math.ceil(ms / 1000)}s`);
      await sleep(ms);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const stateFile = process.env.GH_API_RETRY_STATE;
    if (!stateFile) throw new Error('Missing GitHub retry budget state file');
    const budget = createRateLimitBudget({
      maxWaitMs: Number(process.env.GH_API_MAX_WAIT_SECONDS || 240) * 1000,
      state: JSON.parse(readFileSync(stateFile, 'utf8')),
    });
    process.stdout.write(await ghApi(process.argv.slice(2), {
      budget, save: (state) => writeFileSync(stateFile, JSON.stringify(state)),
    }));
  } catch (error) {
    console.error(error.rateLimited ? `::warning::${error.message}` : `::error::${error.message}`);
    process.exitCode = error.rateLimited ? 78 : 2;
  }
}
