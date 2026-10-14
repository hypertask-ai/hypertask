#!/usr/bin/env node
/** Production error collector. Node 24 ESM, no dependencies. */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOUR = 3600000;
const DAY = 24 * HOUR;
const CONTROL = 'YPER4-354';
const iso = time => new Date(time).toISOString();
const day = time => iso(time).slice(0, 10);
const html = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const diagnostic = text => console.error(`error-collector: ${text}`);

export function redact(text) {
  return String(text ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/(["']?\bauthorization["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\r\n]*)/gi, '$1[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(["']?\b(?:[\w-]*(?:token|key|password|passwd|secret|authorization)[\w-]*)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/\b(?:sk|pk|ghp|gho|github_pat|AKIA)[-_]?[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g, '[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, url => url.replace(/\/\/[^/@]+@/, '//[redacted]@').replace(/\?[^#]*/, '').replace(/#.*$/, ''))
    .replace(/\b[A-Za-z0-9_+\/-]{32,}={0,2}\b/g, '[redacted]');
}

export function normalize(text, route = false) {
  const id = route ? ':id' : '<id>';
  return String(text ?? '')
    .replace(/https?:\/\/[^\s<>"']+/gi, url => url.replace(/\?[^#]*/, '').replace(/#.*$/, ''))
    .replace(/\?[^\s]*/g, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, id)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, id)
    .replace(/\b(?:[0-9a-f]{12,}|c[a-z0-9]{20,})\b/gi, id)
    // Quoted names like `prisma.task.deleteMany()` say what failed; quoted user text and values do not.
    .replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, quoted => (/[\s\d]/.test(quoted) || quoted.length > 62 ? id : quoted))
    .replace(/\b\d+(?:\.\d+)?\b/g, route ? id : '<n>')
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}

// One kind of error is one ticket, whichever routes it shows up on; the ticket lists the routes.
export function fingerprint(service, message) {
  return createHash('sha256').update(`${service}|${normalize(message)}`).digest('hex').slice(0, 16);
}

function command(name, args, env, input) {
  // Never echo child output: CLI errors and receipts may contain credentials.
  const result = spawnSync(name, args, { env, input, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('command failed');
  return result.stdout;
}

function payload(text) {
  const value = JSON.parse(text);
  if (!value || value.success !== true || value.error) throw new Error('invalid response');
  return value;
}

function ticketRef(task) {
  const ref = task?.ticketNumber;
  if (typeof ref !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(ref)) throw new Error('invalid ticket receipt');
  return ref;
}

async function save(state, root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700);
  const temp = join(root, `.state-${randomUUID()}`);
  try {
    const file = await fs.open(temp, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(state)}\n`); await file.sync(); } finally { await file.close(); }
    await fs.rename(temp, join(root, 'state.json'));
    const directory = await fs.open(root, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fs.rm(temp, { force: true }); }
}

async function load(root) {
  try {
    const state = JSON.parse(await fs.readFile(join(root, 'state.json'), 'utf8'));
    if (state.version !== 1 || !state.sources || !state.fingerprints || !state.pending || !state.days || !state.summaries || !state.activities || !Array.isArray(state.created)) throw new Error('invalid state');
    return state;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, sources: {}, fingerprints: {}, pending: {}, days: {}, summaries: {}, activities: {}, created: [] };
  }
}

export async function loadSources(names) {
  const files = names ?? ['vercel', 'vercel-5xx', 'github-actions', 'vps-journal', 'cloudflare-workers', 'posthog'];
  return files.map(name => ({
    name,
    async fetch(context) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('invalid source name');
      const source = await import(pathToFileURL(join(HERE, 'sources', `${name}.mjs`)));
      if (source.name !== name || typeof source.fetch !== 'function') throw new Error('invalid source contract');
      return source.fetch(context);
    },
  }));
}

function validate(event) {
  if (!event || (event.ticket != null && typeof event.ticket !== 'boolean') || ![15, 4060].includes(event.board) || typeof event.service !== 'string' || !/^[A-Za-z][A-Za-z0-9 ._-]{0,79}$/.test(event.service) || ['__proto__', 'constructor', 'prototype'].includes(event.service) || typeof event.message !== 'string' || (event.route != null && typeof event.route !== 'string') || (event.stack != null && typeof event.stack !== 'string') || !Number.isFinite(Date.parse(event.ts)) || !Number.isSafeInteger(event.count ?? 1) || (event.count ?? 1) < 1) throw new Error('invalid event');
  return { ...event, ts: iso(Date.parse(event.ts)), count: event.count ?? 1, route: event.route ?? '', stack: event.stack ?? '' };
}

function merge(group, event) {
  group.count += event.count;
  group.firstSeen = group.firstSeen < event.ts ? group.firstSeen : event.ts;
  group.lastSeen = group.lastSeen > event.ts ? group.lastSeen : event.ts;
  group.routes = [...new Set([...group.routes, redact(event.route)])];
}

function description(group, fp) {
  const fields = [ ['Service', group.service], ['Routes', group.routes.join(', ')], ['Count in window', group.count], ['First seen', group.firstSeen], ['Last seen', group.lastSeen], ['Sample message', group.message] ];
  return `<p><strong>${html(group.service)} is failing: ${html(group.normalized)}. This happened ${group.count} times in the collected window.</strong></p><ul>${fields.map(([key, value]) => `<li>${key}: ${html(value)}</li>`).join('')}</ul><pre>${html(group.stack.split('\n').slice(0, 40).join('\n'))}</pre><p>error-fingerprint:${fp}</p>`;
}

function search(fp, board, env) {
  let found;
  for (const status of ['Normal', 'Archive', 'Deleted']) {
    let offset = 0;
    for (;;) {
      const query = new URLSearchParams({ status, search: `error-fingerprint:${fp}`, projectId: String(board), limit: '100', offset: String(offset) });
      const value = payload(command('ht', ['GET', `/mcp/tasks?${query}`], env));
      if (!Array.isArray(value.tasks) || !Number.isSafeInteger(value.total) || value.total < 0 || (value.tasks.length === 0 && offset < value.total)) throw new Error('invalid search page');
      for (const task of value.tasks) {
        if (task.projectId !== board) throw new Error('wrong board in search');
        if (typeof task.description === 'string' && new RegExp(`error-fingerprint:${fp}(?![a-f0-9])`).test(task.description)) {
          const match = { ticket: ticketRef(task), deleted: status === 'Deleted' };
          if (!found || match.deleted) found = match;
        }
      }
      offset += value.tasks.length;
      if (offset >= value.total) break;
      if (offset > 10000) throw new Error('search exceeds page budget');
    }
  }
  return found;
}

function intake(env) {
  const value = payload(command('ht', ['GET', '/mcp/projects/4060/sections'], env));
  if (!Array.isArray(value.sections)) throw new Error('invalid sections');
  const active = value.sections.filter(section => section.projectId === 4060 && !section.deleted && section.isDone !== true && Number.isSafeInteger(section.id));
  const section = active.find(section => /^backlog$/i.test(section.section_title)) ?? active.find(section => /^(to[ -]?do|todo)$/i.test(section.section_title));
  if (!section) throw new Error('no intake section');
  return String(section.id);
}

export async function collect({ env = process.env, now = Date.now(), sources, dryRun = false, summary = false } = {}) {
  const root = env.ERROR_COLLECTOR_STATE_DIR ?? join(env.HOME ?? homedir(), '.local/state/error-collector');
  const state = await load(root);
  const checkpoint = () => dryRun ? Promise.resolve() : save(state, root);
  const write = (name, args, input, extraEnv = {}) => {
    if (dryRun) { console.log(`DRY-RUN ${JSON.stringify({ command: name, args, ...(input == null ? {} : { input }) })}`); return ''; }
    return command(name, args, { ...env, ...extraEnv }, input);
  };
  const noise = JSON.parse(await fs.readFile(join(HERE, 'noise.json'), 'utf8')).map(rule => ({ ...rule, regex: new RegExp(rule.match, 'i') }));
  const cap = Number(env.ERROR_COLLECTOR_HOURLY_CAP ?? 5);
  if (!Number.isSafeInteger(cap) || cap < 0) throw new Error('invalid hourly cap');
  const stats = (date, service) => {
    state.days[date] ??= {};
    return state.days[date][service] ??= { errors: 0, noise: 0, newGroups: 0 };
  };
  const groups = new Map();
  let succeeded = 0;
  for (const source of sources ?? await loadSources()) {
    try {
      const previous = Date.parse(state.sources[source.name]);
      const since = iso(Math.max(now - DAY, Math.min(now, Number.isFinite(previous) ? previous : now - DAY)));
      const until = iso(now);
      const fetched = await source.fetch({ since, until, env });
      if (!Array.isArray(fetched)) throw new Error('invalid source response');
      const events = fetched.map(validate).filter(event => event.ts > since && event.ts <= until);
      // Routing must stay stable for a fingerprint, whose specified hash excludes board.
      const boards = new Map([...groups].map(([fp, group]) => [fp, group.board]));
      for (const event of events) {
        if (event.ticket === false) continue;
        const fp = fingerprint(event.service, event.message, event.route);
        const board = state.fingerprints[fp]?.board ?? state.pending[fp]?.board ?? boards.get(fp);
        if (board != null && board !== event.board) throw new Error('conflicting board routing');
        boards.set(fp, event.board);
      }
      for (const event of events) {
        const counts = stats(day(event.ts), event.service);
        if (noise.some(rule => (!rule.service || rule.service === event.service) && rule.regex.test(`${event.message}\n${event.route}`))) { counts.noise += event.count; continue; }
        counts.errors += event.count;
        if (event.ticket === false) continue;
        const fp = fingerprint(event.service, event.message, event.route);
        if (!groups.has(fp)) groups.set(fp, { board: event.board, service: event.service, normalized: redact(normalize(event.message)), message: redact(event.message).slice(0, 4000), stack: redact(event.stack).split('\n').slice(0, 40).join('\n').slice(0, 12000), routes: [], count: 0, firstSeen: event.ts, lastSeen: event.ts });
        merge(groups.get(fp), event);
      }
      for (let date = Date.parse(`${day(since)}T00:00:00Z`); date <= now; date += DAY) stats(day(date), source.name);
      if (dryRun) console.log(`DRY-RUN source ${JSON.stringify({ name: source.name, since, until, events: events.length, count: events.reduce((sum, event) => sum + event.count, 0) })}`);
      state.sources[source.name] = until;
      succeeded++;
    } catch { diagnostic(`source ${/^[a-z][a-z0-9-]*$/.test(source.name) ? source.name : '[invalid]'} failed; cursor unchanged`); }
  }
  if (dryRun) console.log(`DRY-RUN counts ${JSON.stringify(state.days)}`);
  if (!succeeded) return 1;
  for (const [fp, group] of groups) {
    const known = state.fingerprints[fp];
    if (known) {
      const newRoutes = group.routes.filter(route => route && !known.routes?.includes(route));
      known.routes = [...new Set([...(known.routes ?? []), ...group.routes])];
      known.total += group.count;
      known.firstSeen = known.firstSeen < group.firstSeen ? known.firstSeen : group.firstSeen;
      known.lastSeen = known.lastSeen > group.lastSeen ? known.lastSeen : group.lastSeen;
      if (!known.deleted) {
        const activity = state.activities[known.ticket] ??= { count: 0, since: group.firstSeen, at: known.lastActivityAt };
        activity.routes = [...new Set([...(activity.routes ?? []), ...newRoutes])];
        activity.count += group.count;
        activity.since = activity.since < group.firstSeen ? activity.since : group.firstSeen;
      }
    } else if (state.pending[fp]) {
      const pending = state.pending[fp];
      pending.count += group.count;
      pending.firstSeen = pending.firstSeen < group.firstSeen ? pending.firstSeen : group.firstSeen;
      pending.lastSeen = pending.lastSeen > group.lastSeen ? pending.lastSeen : group.lastSeen;
      pending.routes = [...new Set([...pending.routes, ...group.routes])];
    } else { state.pending[fp] = group; stats(day(group.firstSeen), group.service).newGroups++; }
  }
  state.created = state.created.filter(time => Date.parse(time) > now - HOUR);
  for (const date of Object.keys(state.days)) if (date < day(now - 13 * DAY)) delete state.days[date];
  for (const date of Object.keys(state.summaries)) if (date < day(now - 13 * DAY)) delete state.summaries[date];
  // Persist fetched data before external writes so interrupted runs retry pending groups.
  await checkpoint();
  let held = 0;
  let section;
  for (const [fp, group] of Object.entries(state.pending)) {
    try {
      let found = search(fp, group.board, env);
      if (!found) {
        if (state.created.length >= cap) { held++; continue; }
        const column = group.board === 15 ? 'Bugs' : (section ??= intake(env));
        const text = description(group, fp);
        let temp;
        const path = dryRun ? '<tmp-description.html>' : join(root, `.description-${randomUUID()}.html`);
        try {
          if (!dryRun) { temp = path; await fs.writeFile(path, text, { mode: 0o600, flag: 'wx' }); }
          // Reserve before create; ambiguous failures still consume cap until reconciled.
          state.created.push(iso(now));
          await checkpoint();
          const output = write('vcc', ['--json', 'task', 'create', '--project', String(group.board), '--section', column, '--labels', 'prod-error', '--priority', 'high', '--title', `${group.service}: ${group.normalized.slice(0, 150)}`, '--description-file', path]);
          if (dryRun) { console.log(`DRY-RUN description ${JSON.stringify(text)}`); found = { ticket: `DRYRUN-${state.created.length}`, deleted: false }; }
          else found = { ticket: ticketRef(payload(output).task), deleted: false };
          state.fingerprints[fp] = { ...found, board: group.board, firstSeen: group.firstSeen, lastSeen: group.lastSeen, total: group.count, routes: group.routes, lastActivityAt: iso(now) };
        } finally { if (temp) await fs.rm(temp, { force: true }); }
      } else {
        state.fingerprints[fp] = { ...found, board: group.board, firstSeen: group.firstSeen, lastSeen: group.lastSeen, total: group.count, routes: group.routes, lastActivityAt: null };
        if (!found.deleted) {
          const activity = state.activities[found.ticket] ??= { count: 0, since: group.firstSeen, at: null };
          activity.routes = [...new Set([...(activity.routes ?? []), ...group.routes.filter(Boolean)])];
          activity.count += group.count;
          activity.since = activity.since < group.firstSeen ? activity.since : group.firstSeen;
        }
      }
      delete state.pending[fp];
      await checkpoint();
    } catch { diagnostic(`group ${fp} reporting failed; kept pending`); }
  }
  for (const [ticket, activity] of Object.entries(state.activities)) {
    const records = Object.values(state.fingerprints).filter(record => record.ticket === ticket);
    const lastActivity = Math.max(0, Date.parse(activity.at) || 0, ...records.map(record => Date.parse(record.lastActivityAt) || 0));
    if (!activity.count || records.some(record => record.deleted) || now - lastActivity < 6 * HOUR) continue;
    const total = records.reduce((sum, record) => sum + record.total, 0);
    const lastSeen = records.map(record => record.lastSeen).sort().at(-1);
    try {
      const routes = (activity.routes ?? []).slice(0, 3).map(route => route.trim().slice(0, 120)).join(', ');
      write('vcc', ['activity', 'add', ticket, `${activity.count} more since ${activity.since}, ${total} total, last seen ${lastSeen}${routes ? `; new routes: ${routes}` : ''}`]);
      activity.count = 0;
      activity.routes = [];
      activity.since = iso(now);
      activity.at = iso(now);
      for (const record of records) record.lastActivityAt = iso(now);
      await checkpoint();
    } catch { diagnostic('activity failed; retry next run'); }
  }
  if (held) {
    try { write('vcc', ['activity', 'add', CONTROL, `${held} error groups held back by the hourly cap`]); }
    catch { diagnostic('held-back notice failed'); }
  }
  // Retry retained completed days, oldest first; partial days cannot reveal a full-day spike.
  if (summary || new Date(now).getUTCHours() >= 6) {
    const services = new Set(Object.values(state.days).flatMap(counts => Object.keys(counts)));
    const dates = Object.keys(state.days).filter(date => date < day(now) && [...services].some(service => !state.summaries[date]?.[service])).sort().slice(0, 3);
    for (const date of dates) {
      const previousDate = day(Date.parse(`${date}T00:00:00Z`) - DAY);
      for (const service of services) {
        if (state.summaries[date]?.[service]) continue;
        const counts = stats(date, service);
        const previous = state.days[previousDate]?.[service]?.errors ?? 0;
        const text = `${service}: ${counts.errors} errors (yesterday ${previous}), ${counts.newGroups} new kinds, ${counts.noise} noise`;
        try {
          write('vcc', ['activity', 'add', CONTROL, text]);
          if (counts.errors > 3 * previous && counts.errors >= 50) {
            const spike = `SPIKE ${date} ${text}`;
            try { write('runner-deliver', ['ht-product-lead'], `${spike}\n`, { RUNNER_DELIVER_ID: `error-collector:${date}:${service}` }); }
            catch {
              if (dryRun) console.log(`DRY-RUN spikes.log ${JSON.stringify(spike)}`);
              else await fs.appendFile(join(root, 'spikes.log'), `${spike}\n`, { mode: 0o600 });
              diagnostic('spike delivery unavailable; recorded in spikes.log');
            }
          }
          (state.summaries[date] ??= {})[service] = true;
          await checkpoint();
        } catch { diagnostic('summary failed; retry next run'); }
      }
    }
  }
  await checkpoint();
  return 0;
}

async function install(env) {
  const home = env.HOME ?? homedir();
  const target = join(home, '.local/lib/hypertask/error-collector');
  const units = join(home, '.config/systemd/user');
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(units, { recursive: true });
  await fs.mkdir(join(home, '.local/state/error-collector'), { recursive: true, mode: 0o700 });
  if (HERE !== target) {
    for (const name of ['collector.mjs', 'io.mjs', 'noise.json']) await fs.copyFile(join(HERE, name), join(target, name));
    await fs.cp(join(HERE, 'sources'), join(target, 'sources'), { recursive: true });
  }
  await fs.chmod(join(target, 'collector.mjs'), 0o755);
  for (const suffix of ['service', 'timer']) {
    const name = `error-collector.${suffix}`;
    if (HERE !== target) await fs.copyFile(join(HERE, '..', name), join(target, name));
    await fs.copyFile(join(target, name), join(units, name));
  }
  command('systemctl', ['--user', 'daemon-reload'], env);
  command('systemctl', ['--user', 'enable', '--now', 'error-collector.timer'], env);
  console.log('Installed error-collector user timer');
}

async function main() {
  process.umask(0o077);
  const { values } = parseArgs({ options: { once: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, sources: { type: 'string' }, summary: { type: 'boolean' }, install: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('collector.mjs [--once] [--dry-run] [--sources fixture,...] [--summary] | --install\nSee README.md for source and state contracts.'); return; }
  if (values.install) {
    if (Object.keys(values).length !== 1) throw new Error('install cannot be combined with run flags');
    await install(process.env);
  } else {
    const names = values.sources?.split(',');
    if (names?.some(name => !/^[a-z][a-z0-9-]*$/.test(name)) || (names && new Set(names).size !== names.length)) throw new Error('invalid sources');
    if (!values['dry-run'] && process.env.ERROR_COLLECTOR_LOCKED !== '1') {
      const root = process.env.ERROR_COLLECTOR_STATE_DIR ?? join(process.env.HOME ?? homedir(), '.local/state/error-collector');
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      await fs.chmod(root, 0o700);
      // Also serialize manual --once runs; dry runs only read atomic snapshots.
      const result = spawnSync('/usr/bin/flock', ['--nonblock', join(root, 'run.lock'), process.execPath, ...process.argv.slice(1)], { env: { ...process.env, ERROR_COLLECTOR_LOCKED: '1' }, stdio: 'inherit' });
      process.exitCode = result.status ?? 1;
      return;
    }
    process.exitCode = await collect({ sources: await loadSources(names), dryRun: values['dry-run'], summary: values.summary });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { diagnostic('configuration, state or installation failed; response bodies not logged'); process.exitCode = 1; });
}
