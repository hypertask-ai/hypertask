import { key, query } from '../io.mjs';

export const name = 'posthog';

function browserMessage(exception) {
  const { type, value } = exception ?? {};
  if (!value) return type || '$exception';
  return type && !String(value).startsWith(type) ? `${type}: ${value}` : String(value);
}

function browserStack(exception) {
  const frames = exception?.stacktrace?.frames;
  if (!Array.isArray(frames)) return '';
  // PostHog lists frames oldest first; the throwing frame is last.
  return frames.slice(-20).reverse().map(frame => `at ${frame.resolved_name || frame.mangled_name || frame.function || '?'} (${frame.source || frame.filename || '?'}:${frame.line ?? frame.lineno ?? '?'})`).join('\n');
}

export function parseExceptions(data) {
  if (data.error || data.hasMore || !Array.isArray(data.results) || data.results.length >= 10000) throw new Error('PostHog query incomplete');
  return data.results.map(row => {
    const [, count, , last, , source, exceptions, route] = row;
    const list = typeof exceptions === 'string' ? JSON.parse(exceptions) : exceptions;
    const ts = new Date(last.endsWith('Z') || /[+-]\d\d:\d\d$/.test(last) ? last : `${last.replace(' ', 'T')}Z`).toISOString();
    // The native PostHog alert tickets server errors only (src/lib/telemetry/posthogErrorAlert.ts), so browser errors are ticketed here.
    if (source === 'browser') return { service: 'browser', board: 15, message: browserMessage(list?.[0]), route: route ?? '', stack: browserStack(list?.[0]), ts, count };
    return { service: name, board: 15, ticket: false, message: list?.[0]?.value ?? '$exception', route: route ?? '', stack: '', ts, count };
  });
}

export async function fetch({ since, until, env }) {
  const token = key('posthog', 'POSTHOG_FULL_API_KEY', env);
  const projects = new Set([key('posthog', 'POSTHOG_PROJECT_ID', env), key('posthog', 'POSTHOG_SERVER_PROJECT_ID', env)]);
  const output = [];
  for (const project of projects) {
    if (!/^\d+$/.test(project)) throw new Error('invalid PostHog project');
    const sql = `SELECT toString(properties.$exception_issue_id) AS issue_id, count() AS count, min(timestamp) AS first_seen, max(timestamp) AS last_seen, coalesce(toString(properties.ht_environment), toString(properties.$environment), if(properties.$current_url LIKE 'https://app.hypertask.ai/%', 'production-inferred-url', 'unknown')) AS environment, coalesce(toString(properties.ht_source), if(distinct_id = 'hypertask-app', 'server', if(properties.$lib = 'web', 'browser', toString(properties.$lib)))) AS source, toString(properties.$exception_list) AS exceptions, toString(properties.$current_url) AS url FROM events WHERE event = '$exception' AND (properties.ht_environment = 'production' OR (properties.ht_environment IS NULL AND properties.$current_url LIKE 'https://app.hypertask.ai/%')) AND timestamp > toDateTime('${new Date(since).toISOString()}') AND timestamp <= toDateTime('${new Date(until).toISOString()}') GROUP BY issue_id, environment, source, exceptions, url ORDER BY count DESC LIMIT 10000`;
    const response = await query(`https://eu.posthog.com/api/projects/${project}/query/`, token, { query: { kind: 'HogQLQuery', query: sql }, refresh: 'force_blocking' });
    if (response.status !== 200) throw new Error(`PostHog HTTP ${response.status}`);
    output.push(...parseExceptions(response.data));
  }
  return output;
}
