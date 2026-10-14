import { key, query } from '../io.mjs';

export const name = 'cloudflare-workers';

export function parseWorkers(data, until) {
  if (data.errors?.length || !Array.isArray(data.data?.viewer?.accounts) || data.data.viewer.accounts.length !== 1) throw new Error('Cloudflare analytics unavailable');
  const rows = data.data.viewer.accounts[0].current;
  if (!Array.isArray(rows) || rows.length >= 10000) throw new Error('Cloudflare analytics incomplete');
  return rows.filter(row => row.sum.errors > 0).map(row => ({ service: name, board: 4060, message: `${row.dimensions.scriptName}: Worker execution errors`, route: row.dimensions.scriptName, stack: 'Adaptive analytics counts may be sampled/estimated; not HTTP response errors.', ts: until, count: row.sum.errors }));
}

export async function fetch({ since, until, env }) {
  const token = key('cloudflare', 'CLOUDFLARE_API_TOKEN', env);
  const accounts = await query('https://api.cloudflare.com/client/v4/accounts?per_page=50', token);
  if (accounts.status !== 200 || accounts.data.success === false || !Array.isArray(accounts.data.result)) throw new Error('Cloudflare account read failed');
  const matches = accounts.data.result.filter(account => /hypertask/i.test(account.name));
  if (matches.length !== 1) throw new Error('Hypertask account not uniquely identified');
  const output = [];
  const end = Date.parse(until);
  let start = Date.parse(since);
  let first = true;
  while (start <= end) {
    const midnight = Date.parse(`${new Date(start).toISOString().slice(0, 10)}T00:00:00Z`) + 86400000;
    const stop = Math.min(midnight, end);
    const beforeMidnight = stop === midnight;
    const sql = `query { viewer { accounts(filter: { accountTag: ${JSON.stringify(matches[0].id)} }) { current: workersInvocationsAdaptive(limit: 10000, filter: { datetime_${first ? 'gt' : 'geq'}: ${JSON.stringify(new Date(start).toISOString())}, datetime_${beforeMidnight ? 'lt' : 'leq'}: ${JSON.stringify(new Date(stop).toISOString())} }) { sum { errors requests } dimensions { scriptName } } } } }`;
    const response = await query('https://api.cloudflare.com/client/v4/graphql', token, { query: sql });
    if (response.status !== 200) throw new Error(`Cloudflare HTTP ${response.status}`);
    output.push(...parseWorkers(response.data, new Date(beforeMidnight ? stop - 1 : stop).toISOString()));
    if (!beforeMidnight) break;
    start = stop;
    first = false;
  }
  return output;
}
