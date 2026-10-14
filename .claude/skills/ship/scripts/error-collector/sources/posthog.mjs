import { key, query } from '../io.mjs';

export const name = 'posthog';

export function parseExceptions(data) {
  if (data.error || data.hasMore || !Array.isArray(data.results) || data.results.length >= 10000) throw new Error('PostHog query incomplete');
  return data.results.map(row => {
    const [, count, , last, , , exceptions, route] = row;
    const list = typeof exceptions === 'string' ? JSON.parse(exceptions) : exceptions;
    return { service: name, board: 15, ticket: false, message: list?.[0]?.value ?? '$exception', route: route ?? '', stack: '', ts: new Date(last.endsWith('Z') || /[+-]\d\d:\d\d$/.test(last) ? last : `${last.replace(' ', 'T')}Z`).toISOString(), count };
  });
}

export async function fetch({ since, until, env }) {
  const token = key('posthog', 'POSTHOG_FULL_API_KEY', env);
  const projects = new Set([key('posthog', 'POSTHOG_PROJECT_ID', env), key('posthog', 'POSTHOG_SERVER_PROJECT_ID', env)]);
  const output = [];
  for (const project of projects) {
    if (!/^\d+$/.test(project)) throw new Error('invalid PostHog project');
    const sql = `SELECT toString(properties.$exception_issue_id) AS issue_id, count() AS count, min(timestamp) AS first_seen, max(timestamp) AS last_seen, coalesce(toString(properties.ht_environment), toString(properties.$environment), if(properties.$current_url LIKE 'https://app.hypertask.ai/%', 'production-inferred-url', 'unknown')) AS environment, coalesce(toString(properties.ht_source), if(distinct_id = 'hypertask-app', 'server', if(properties.$lib = 'web', 'browser', toString(properties.$lib)))) AS source, toString(properties.$exception_list) AS exceptions, toString(properties.$current_url) AS url FROM events WHERE event = '$exception' AND timestamp >= toDateTime('${new Date(since).toISOString()}') AND timestamp < toDateTime('${new Date(until).toISOString()}') GROUP BY issue_id, environment, source, exceptions, url ORDER BY count DESC LIMIT 10000`;
    const response = await query(`https://eu.posthog.com/api/projects/${project}/query/`, token, { query: { kind: 'HogQLQuery', query: sql }, refresh: 'force_blocking' });
    if (response.status !== 200) throw new Error(`PostHog HTTP ${response.status}`);
    output.push(...parseExceptions(response.data));
  }
  return output;
}
