import { key, query } from '../io.mjs';

export const name = 'vercel';
const realtimeFailure = row => /^\[realtime\] broadcast failed(?:\s|$)/.test(messageParts(row.message).message);
const infra = [
  event => event.message.includes('Vercel Runtime Timeout Error'),
  event => event.route === '/sse',
  // Outgoing board and agent webhooks that used up every retry (YPER4-358).
  event => /^\[(board|agent)-webhook\] delivery failed/.test(event.message),
];

export function messageParts(message) {
  if (typeof message === 'string') {
    try { message = JSON.parse(message); } catch { /* Plain runtime messages are common. */ }
  }
  if (message && typeof message === 'object') {
    message = 'message' in message ? `${message.message}${message.error ? ` | ${typeof message.error === 'string' ? message.error : JSON.stringify(message.error)}` : ''}` : JSON.stringify(message);
  }
  const [cause, ...frames] = String(message ?? '').split(/\n\s+at /);
  let text = cause;
  if (text.includes('PrismaClientValidationError')) {
    const invocation = text.match(/Invalid `([^`]+)` invocation:/);
    const detail = text.match(/(Invalid value for argument `[^`]+`:[^\n]+|Argument `[^`]+`:[^\n]+)/);
    if (invocation && detail) text = `PrismaClientValidationError: Invalid \`${invocation[1]}\` invocation: ${detail[1]}`;
  }
  return { message: text, stack: frames.length ? `at ${frames.join('\n  at ')}` : '' };
}

export function parseEvents(rows, service = name) {
  if (!Array.isArray(rows)) throw new Error('invalid Vercel events');
  return rows.filter(row => service === 'realtime' ? realtimeFailure(row) : service === name ? !realtimeFailure(row) : Number(row.httpStatus) >= 500).map(row => {
    const event = {
      service, board: service === 'realtime' ? 4060 : 15, route: row.requestPath ?? '', ts: row.timestamp, count: 1,
      // 5xx responses repeat failures the error log already holds: count them, never ticket them.
      ...(service === 'vercel-5xx' ? { message: `HTTP ${row.httpStatus} ${row.requestMethod ?? ''} response`, stack: '', ticket: false } : messageParts(row.message)),
    };
    if (service === name && infra.some(rule => rule(event))) event.board = 4060;
    // Resend bounces and failed sends (YPER4-359).
    if (service === name && event.message.startsWith('[email-event]')) {
      event.service = 'email';
      event.board = 4060;
    }
    return event;
  });
}

export async function fetchVercel({ since, until, env }, service = name) {
  const token = key('vercel', 'VERCEL_TOKEN', env);
  const team = key('vercel', 'VERCEL_TEAM_ID', env);
  const project = key('vercel', 'VERCEL_PROJECT_ID', env);
  const proxy = service === 'vercel-5xx';
  const base = {
    event: proxy ? 'vercel.proxy_response' : 'vercel.log',
    scope: { ownerId: team, projectIds: [project] },
    select: proxy ? ['projectId', 'requestId', 'deploymentId', 'environment', 'requestPath', 'requestMethod', 'httpStatus', 'route', 'pathType'] : ['projectId', 'requestId', 'deploymentId', 'domain', 'environment', 'requestPath', 'requestMethod', 'source', 'service', 'isSystemLog', 'region', 'runtime', 'level', 'message', 'stream', 'traceId', 'spanId', 'attributes', 'truncated'],
    order: 'desc', limit: 500,
    filter: proxy ? 'httpStatus >= 500 AND environment:production AND NOT pathType:"background_func"' : service === 'realtime' ? '(level:warning OR level:error) AND environment:production' : 'level:error AND environment:production',
  };
  let calls = 0;
  const unique = new Map();
  async function window(start, end, depth = 0) {
    let cursor;
    const cursors = new Set();
    for (let page = 0; page < 30; page++) {
      if (++calls > 120) throw new Error('Vercel query budget exceeded');
      const { status, data } = await query(`https://api.vercel.com/v1/observability/events?teamId=${encodeURIComponent(team)}`, token,
        { ...base, timeRange: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }, ...(cursor ? { cursor } : {}) },
        { 'x-vercel-observability-query-reason': proxy ? 'cli/logs-requests' : 'cli/logs-runtime' });
      if (status === 429) throw new Error('Vercel HTTP 429');
      if (status === 413 && depth < 12 && end - start > 1000) {
        const middle = Math.floor((start + end) / 2);
        await window(start, middle, depth + 1);
        await window(middle, end, depth + 1);
        return;
      }
      if (status === 400 && /retain.*runtime logs|retention/i.test(JSON.stringify(data)) && end - start > 600000 && depth < 12) {
        console.error(`error-collector: source ${service} retention gap; moving start forward 10 minutes`);
        await window(start + 600000, end, depth + 1);
        return;
      }
      if (status !== 200) throw new Error(`Vercel HTTP ${status}`);
      if (!Array.isArray(data.events) || data.events.some(row => row.truncated) || data.meta?.excludedIntervals?.length) throw new Error('incomplete Vercel response');
      for (const row of data.events) unique.set(JSON.stringify(row), row);
      if (!data.pagination?.hasMore) return;
      cursor = data.pagination.nextCursor;
      if (!cursor || cursors.has(cursor)) throw new Error('invalid Vercel cursor');
      cursors.add(cursor);
    }
    throw new Error('Vercel page budget exceeded');
  }
  await window(Date.parse(since), Date.parse(until));
  return parseEvents([...unique.values()], service);
}

export async function fetch(context) { return fetchVercel(context); }
