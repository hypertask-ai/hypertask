import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'neon';
const counters = ['xact_commit', 'xact_rollback', 'deadlocks', 'conflicts', 'temp_files', 'temp_bytes'];

export async function fetch({ until, env, cursor }) {
  try {
    const threshold = Number(env.NEON_SLOW_QUERY_MS ?? 1000);
    const rollbackAlert = Number(env.NEON_ROLLBACK_ALERT ?? 500);
    if (!Number.isFinite(threshold) || threshold < 0 || !Number.isSafeInteger(rollbackAlert) || rollbackAlert < 0) throw new Error();
    const connection = (await readFile(env.NEON_STATS_URL_FILE ?? join(env.HOME ?? homedir(), '.local/state/error-collector/neon-stats.url'), 'utf8')).trim();
    const url = new URL(connection);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error();
    async function sql(query, params) {
      const response = await globalThis.fetch(`https://${url.hostname}/sql`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Neon-Connection-String': connection, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, params }),
        signal: AbortSignal.timeout(90000),
      });
      if (response.status !== 200) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.rows)) throw new Error();
      return data.rows;
    }
    const slow = await sql('SELECT * FROM ops_stats.slow_queries($1::double precision, $2::integer)', [threshold, 50]);
    if (slow.length > 50) throw new Error();
    const events = slow.map(row => {
      if (typeof row.query !== 'string' || !row.query.trim() || row.query.length > 500 || !['total_ms', 'mean_ms', 'max_ms'].every(field => Number.isFinite(Number(row[field])) && row[field] != null && Number(row[field]) >= 0) || !['calls', 'rows_returned'].every(field => /^\d+$/.test(String(row[field]))) || !/^-?\d+$/.test(String(row.queryid))) throw new Error();
      return { service: name, board: 4060, message: `slow query: ${row.query.replace(/\s+/g, ' ').trim()}`, stack: `queryid: ${row.queryid}\ncalls: ${row.calls}\nmean_ms: ${row.mean_ms}\nmax_ms: ${row.max_ms}\ntotal_ms: ${row.total_ms}\nrows_returned: ${row.rows_returned}\nstats_since: ${row.stats_since ?? 'unknown'}\nCumulative statistics, not window-only calls.`, ts: until, count: 1, mean: Number(row.mean_ms) };
    }).filter(event => event.mean >= threshold).map(({ mean, ...event }) => event);
    const rows = await sql('SELECT * FROM ops_stats.db_counters()', []);
    if (rows.length !== 1) throw new Error();
    const reading = rows[0];
    if (!counters.every(field => /^\d+$/.test(String(reading[field]))) || (reading.stats_reset != null && !Number.isFinite(Date.parse(reading.stats_reset))) || !Number.isFinite(Date.parse(reading.read_at))) throw new Error();
    const next = Object.fromEntries(counters.map(field => [field, BigInt(reading[field]).toString()]));
    next.stats_reset = reading.stats_reset == null ? null : new Date(reading.stats_reset).toISOString();
    next.read_at = new Date(reading.read_at).toISOString();
    if (cursor && cursor.stats_reset === next.stats_reset && counters.every(field => /^\d+$/.test(String(cursor[field])) && BigInt(next[field]) >= BigInt(cursor[field]))) {
      for (const field of ['deadlocks', 'conflicts', 'xact_rollback']) {
        const delta = BigInt(next[field]) - BigInt(cursor[field]);
        if (delta <= (field === 'xact_rollback' ? BigInt(rollbackAlert) : 0n)) continue;
        if (delta > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
        events.push({ service: name, board: 4060, message: `database ${field} increased`, stack: `delta: ${delta}\nprevious: ${cursor[field]}\ncurrent: ${next[field]}\nread window: ${cursor.read_at} to ${next.read_at}\nstats_reset: ${next.stats_reset ?? 'unknown'}`, ts: until, count: Number(delta) });
      }
    }
    return { events, cursor: next };
  } catch { throw new Error('Neon statistics read failed'); }
}
