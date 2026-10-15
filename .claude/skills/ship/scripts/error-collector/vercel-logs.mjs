#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { key, query } from './io.mjs';

const usage = 'usage: vercel-logs.mjs [--since 10m|2h|<ISO time>] [-n 50] [--level error|warning|info] [--path /api/route] [--search text]';
const units = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 };

export function parseArgs(argv, now = Date.now()) {
  const options = { since: '10m', limit: 50 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--since', '-n', '--level', '--path', '--search'].includes(flag) || value === undefined) throw new Error(usage);
    index += 1;
    if (flag === '--since') options.since = value;
    if (flag === '-n') options.limit = Number(value);
    if (flag === '--level') options.level = value;
    if (flag === '--path') options.path = value;
    if (flag === '--search') options.search = value;
  }
  const relative = /^(\d+)([smhd])$/.exec(options.since);
  const start = relative ? now - Number(relative[1]) * units[relative[2]] : Date.parse(options.since);
  if (!Number.isFinite(start) || start >= now) throw new Error(`invalid --since: ${options.since}`);
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 500) throw new Error('-n must be 1 to 500');
  if (options.level && !['error', 'warning', 'info'].includes(options.level)) throw new Error('--level must be error, warning or info');
  if (options.path && !/^\/[\w\-./[\]]*$/.test(options.path)) throw new Error('--path must be a plain route like /api/ai/chat/stream');
  return { ...options, start: new Date(start).toISOString(), end: new Date(now).toISOString() };
}

export function logFilter({ level, path }) {
  return ['environment:production', level && `level:${level}`, path && `requestPath:"${path}"`].filter(Boolean).join(' AND ');
}

export async function readLogs(options, env = process.env) {
  const token = key('vercel', 'VERCEL_TOKEN', env);
  const team = key('vercel', 'VERCEL_TEAM_ID', env);
  const project = key('vercel', 'VERCEL_PROJECT_ID', env);
  const { status, data } = await query(`https://api.vercel.com/v1/observability/events?teamId=${encodeURIComponent(team)}`, token, {
    event: 'vercel.log',
    scope: { ownerId: team, projectIds: [project] },
    select: ['level', 'requestMethod', 'requestPath', 'deploymentId', 'message'],
    order: 'desc',
    limit: options.search ? 500 : options.limit,
    filter: logFilter(options),
    timeRange: { start: options.start, end: options.end },
  }, { 'x-vercel-observability-query-reason': 'cli/logs-runtime' });
  if (status !== 200) throw new Error(`Vercel HTTP ${status}`);
  const rows = Array.isArray(data?.events) ? data.events : [];
  return rows
    .filter(row => !options.search || String(row.message ?? '').includes(options.search))
    .slice(0, options.limit)
    .map(({ timestamp, level, requestMethod, requestPath, deploymentId, message }) => ({ timestamp, level, requestMethod, requestPath, deploymentId, message }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    for (const row of await readLogs(parseArgs(process.argv.slice(2)))) console.log(JSON.stringify(row));
  } catch (error) {
    console.error(`vercel-logs: ${error.message}`);
    process.exit(1);
  }
}
