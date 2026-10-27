import { command } from '../io.mjs';
import { normalize, isNoise } from '../collector.mjs';

export const name = 'vps-journal';

export function parseJournal(text, { since, until } = {}) {
  const groups = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    const unit = row.USER_UNIT ?? row.UNIT ?? row._SYSTEMD_USER_UNIT ?? row._SYSTEMD_UNIT ?? row.SYSLOG_IDENTIFIER ?? 'unknown-unit';
    if (unit === 'error-collector.service' || row._SYSTEMD_UNIT === 'error-collector.service') continue;
    const outcome = row.JOB_RESULT === 'done' ? 'success' : row.JOB_RESULT === 'failed' ? 'failure' : undefined;
    const message = `${unit}: ${Array.isArray(row.MESSAGE) ? Buffer.from(row.MESSAGE).toString('utf8') : row.MESSAGE}`;
    const ts = new Date(Number(row.__REALTIME_TIMESTAMP) / 1000).toISOString();
    if ((since && ts <= since) || (until && ts > until)) continue;
    // Keep raw status codes for noise rules and separate noise from real errors sharing a normalized key.
    const id = outcome ? `${unit}|${ts}|${row.__CURSOR}` : `${ts.slice(0, 10)}|${unit}|${normalize(message)}|${isNoise({ service: name, message, route: unit })}`;
    const group = groups.get(id);
    if (group) { group.count++; if (ts > group.ts) group.ts = ts; }
    else groups.set(id, { service: name, board: 4060, message, route: unit, stack: '', ts, count: 1, unit, userFacing: /^(nginx|caddy|hypertasks?|ht-slack|soketi|pusher)\.service$/.test(unit), ...(outcome ? { outcome, runId: row.__CURSOR ?? ts } : {}) });
  }
  return [...groups.values()];
}

export async function fetch({ since, until, env }) {
  const args = ['--since', since, '--until', until, '-o', 'json', '--no-pager'];
  const user = command('journalctl', ['--user', '-p', 'err', ...args], env);
  let system = '';
  try {
    const errors = command('journalctl', ['--system', '-p', 'err', ...args], env);
    const completed = command('journalctl', ['--system', 'JOB_RESULT=done', ...args], env);
    system = `${errors}\n${completed}`;
  }
  catch { console.error('error-collector: source vps-journal system journal unavailable'); }
  const completed = command('journalctl', ['--user', 'JOB_RESULT=done', ...args], env);
  // A system journal may also expose user entries; do not count them twice.
  const seen = new Set();
  const text = `${user}\n${system}\n${completed}`.split('\n').filter(line => {
    if (!line) return false;
    const row = JSON.parse(line);
    const id = row.__CURSOR ?? line;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).join('\n');
  return parseJournal(text, { since, until });
}
