import { command } from '../io.mjs';
import { normalize, isNoise } from '../collector.mjs';

export const name = 'vps-journal';

export function parseJournal(text, { since, until } = {}) {
  const groups = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    const unit = row._SYSTEMD_USER_UNIT ?? row._SYSTEMD_UNIT ?? row.SYSLOG_IDENTIFIER ?? 'unknown-unit';
    if (unit === 'error-collector.service' || row._SYSTEMD_UNIT === 'error-collector.service') continue;
    const message = `${unit}: ${Array.isArray(row.MESSAGE) ? Buffer.from(row.MESSAGE).toString('utf8') : row.MESSAGE}`;
    const ts = new Date(Number(row.__REALTIME_TIMESTAMP) / 1000).toISOString();
    if ((since && ts <= since) || (until && ts > until)) continue;
    // Keep raw status codes for noise rules and separate noise from real errors sharing a normalized key.
    const id = `${ts.slice(0, 10)}|${unit}|${normalize(message)}|${isNoise({ service: name, message, route: unit })}`;
    const group = groups.get(id);
    if (group) { group.count++; if (ts > group.ts) group.ts = ts; }
    else groups.set(id, { service: name, board: 4060, message, route: unit, stack: '', ts, count: 1 });
  }
  return [...groups.values()];
}

export async function fetch({ since, until, env }) {
  const args = ['-p', 'err', '--since', since, '--until', until, '-o', 'json', '--no-pager'];
  const user = command('journalctl', ['--user', ...args], env);
  let system = '';
  try { system = command('journalctl', ['--system', ...args], env); }
  catch { console.error('error-collector: source vps-journal system journal unavailable'); }
  // A system journal may also expose user entries; do not count them twice.
  const seen = new Set();
  const text = `${user}\n${system}`.split('\n').filter(line => {
    if (!line) return false;
    const row = JSON.parse(line);
    const id = row.__CURSOR ?? line;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).join('\n');
  return parseJournal(text, { since, until });
}
