#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs, readFileSync } from 'node:fs';
import { withDeadline, timeLeft, bounded } from './io.mjs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { correlate, incidentOf, redact, relatedTicket, taskIncident } from './incident.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOISE = JSON.parse(readFileSync(join(HERE, 'noise.json'), 'utf8')).map(rule => ({ ...rule, regex: new RegExp(rule.match, 'i') }));
const HOUR = 3600000;
const DAY = 24 * HOUR;
const CONTROL = 'YPER4-354';
const iso = time => new Date(time).toISOString();
const day = time => iso(time).slice(0, 10);
const html = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const diagnostic = text => console.error(`error-collector: ${text}`);

function noiseRule(event) {
  const text = `${event.message}\n${event.route}`;
  const matches = NOISE.filter(rule => (!rule.service || rule.service === event.service) && !rule.excludeServices?.includes(event.service) && rule.regex.test(text));
  return matches.find(rule => rule.id === 'forced-test') ?? matches.find(rule => rule.alert) ?? matches[0];
}

export function isNoise(event) {
  return Boolean(noiseRule(event));
}

export { redact } from './incident.mjs';

const FINGERPRINT_RULES = 3;
const isoTime = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;
const rejectedUrl = /(\bInvalid [A-Za-z ]{1,40}: )https?:\/\/\S+/g;
const transientScope = /\brun-(?:u\d+|r[0-9a-f]{32})\.scope\b/g;
const powerShellSession = /\(\d+(?:\.\d+)*:[A-Z]:\d+\)(?= \[NamedPipeIPC_ServerListenerError:NamedPipe\.Exception\.Error\])/g;
const changedByCurrentRules = message => (isoTime.test(message) || new RegExp(rejectedUrl.source).test(message) || new RegExp(transientScope.source).test(message) || new RegExp(powerShellSession.source).test(message)) && !/\[redacted(?:-[a-z]+)?\]/.test(normalize(message));

export function normalize(text, route = false) {
  const id = route ? ':id' : '<id>';
  return String(text ?? '')
    .replace(new RegExp(`^\\s*${isoTime.source}\\s+`), '')
    .replace(new RegExp(`\\b${isoTime.source}`, 'g'), '<time>')
    .replace(rejectedUrl, '$1<url>')
    .replace(transientScope, 'run-<id>.scope')
    .replace(powerShellSession, '<session>')
    .replace(/https?:\/\/[^\s<>"']+/gi, url => url.replace(/\?[^#]*/, '').replace(/#.*$/, ''))
    .replace(/\?[^\s]*/g, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, id)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, id)
    .replace(/\b(?:[0-9a-f]{12,}|c[a-z0-9]{20,})\b/gi, id)
    .replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, quoted => (/[\s\d]/.test(quoted) || quoted.length > 62 ? id : quoted))
    .replace(/\b\d+(?:\.\d+)?\b/g, route ? id : '<n>')
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function fingerprint(service, message) {
  return createHash('sha256').update(`${service}|${normalize(message)}`).digest('hex').slice(0, 16);
}

function noiseFingerprint(service, id) {
  return createHash('sha256').update(`noise|${service}|${id}`).digest('hex').slice(0, 16);
}

function command(name, args, env, input) {
  const result = spawnSync(name, args, { env, input, encoding: 'utf8', timeout: timeLeft(30000), killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
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
  const files = names ?? ['vercel', 'vercel-5xx', 'realtime', 'github-actions', 'vps-journal', 'cloudflare-workers', 'posthog', 'neon'];
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
  if (event.incident?.ts > group.incident?.ts) group.incident = event.incident;
  group.count += event.count;
  group.firstSeen = group.firstSeen < event.ts ? group.firstSeen : event.ts;
  group.lastSeen = group.lastSeen > event.ts ? group.lastSeen : event.ts;
  group.routes = [...new Set([...group.routes, redact(event.route)])];
}

function description(group, fp) {
  if (group.noiseRule) {
    const fields = [ ['Service', group.service], ['Warning', group.normalized], ['Occurrences in one hour', group.hourlyCount], ['Hour ending', group.hourLastSeen], ['Routes', group.routes.join(', ')], ['Redacted sample', group.message] ];
    return `<p><strong>${html(group.service)} emitted ${html(group.normalized)} ${group.hourlyCount} times within one hour.</strong></p><p>This is a warning on stderr, not a thrown product error. Fix it at the source rather than hiding the warning.</p><ul>${fields.map(([key, value]) => `<li>${key}: ${html(value)}</li>`).join('')}</ul><pre>${html(group.stack)}</pre><p>error-fingerprint:${fp}</p>`;
  }
  const fields = [ ['Service', group.service], ['Routes', group.routes.join(', ')], ['Count in window', group.count], ['First seen', group.firstSeen], ['Last seen', group.lastSeen], ['Sample message', group.message] ];
  return `<p><strong>${html(group.service)} is failing: ${html(group.normalized)}. This happened ${group.count} times in the collected window.</strong></p><ul>${fields.map(([key, value]) => `<li>${key}: ${html(value)}</li>`).join('')}</ul><pre>${html(group.stack.split('\n').slice(0, 40).join('\n'))}</pre><p>error-fingerprint:${fp}</p>${group.incident ? `<p>Error root: ${html(group.incident.route)} | ${html(group.incident.root)}</p><p>Error route: ${group.incident.routeKey}</p>` : ''}`;
}

function search(fp, board, env, incident) {
  let found;
  for (const status of ['Normal', 'Archive', 'Deleted']) {
    let offset = 0;
    for (;;) {
      const query = new URLSearchParams({ status, search: `error-fingerprint:${fp}`, projectId: String(board), limit: '100', offset: String(offset) });
      const value = payload(command(env.SHIP_CLAIM_HT ?? 'ht', ['GET', `/mcp/tasks?${query}`], env));
      if (!Array.isArray(value.tasks) || !Number.isSafeInteger(value.total) || value.total < 0 || (value.tasks.length === 0 && offset < value.total)) throw new Error('invalid search page');
      for (const task of value.tasks) {
        if (task.projectId !== board) throw new Error('wrong board in search');
        if (typeof task.description === 'string' && new RegExp(`error-fingerprint:${fp}(?![a-f0-9])`).test(task.description)) {
          const identity = incident && taskIncident(task);
          if (incident && (identity?.routeKey !== incident.routeKey || identity?.root !== incident.root)) continue;
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

export function findRelatedIncident(group, env) {
  const tasks = new Map(group.claim ? [[ticketRef(group.claim), group.claim]] : []);
  const queries = [group.incident.route];
  if (group.incident.route === '/api/mcp/projects') queries.push('hypertask_projects', 'list projects');
  for (const text of queries) {
    let offset = 0;
    for (;;) {
      const query = new URLSearchParams({ status: 'Normal', search: text, projectId: String(group.board), limit: '100', offset: String(offset) });
      const page = payload(command(env.SHIP_CLAIM_HT ?? 'ht', ['GET', `/mcp/tasks?${query}`], env));
      if (!Array.isArray(page.tasks) || !Number.isSafeInteger(page.total) || page.total < 0 || (!page.tasks.length && offset < page.total)) throw new Error('invalid related incident page');
      for (const task of page.tasks) {
        if (task.projectId !== group.board) throw new Error('wrong board in related incident search');
        tasks.set(ticketRef(task), task);
      }
      offset += page.tasks.length;
      if (offset >= page.total) break;
      if (offset >= 10000) throw new Error('related incident search exceeds page budget');
    }
  }
  const found = relatedTicket(group, [...tasks.values()]);
  if (found?.prior) {
    const page = payload(command('ht', ['GET', `/mcp/tasks/${found.ticket}/agent-activity?limit=100`], env));
    if (!Array.isArray(page.activities)) throw new Error('invalid related activity page');
    if (page.activities.length === 100) throw new Error('related activity history truncated');
    const roots = page.activities.flatMap(activity => activity.text?.match(/prisma-validation:\w+:unknown-argument:[\w.]+/g) ?? []);
    if (roots.some(root => root !== group.incident.root)) return;
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

export async function collect(options = {}) {
  return withDeadline(options.timeoutMs ?? 12 * 60 * 1000, signal => run(options, signal));
}

async function run({ env = process.env, now = Date.now(), sources, dryRun = false, summary = false }, signal) {
  const root = env.ERROR_COLLECTOR_STATE_DIR ?? join(env.HOME ?? homedir(), '.local/state/error-collector');
  const state = await load(root);
  const checkpoint = () => dryRun ? Promise.resolve() : save(state, root);
  const write = (name, args, input, extraEnv = {}) => {
    timeLeft(Infinity);
    if (dryRun) { console.log(`DRY-RUN ${JSON.stringify({ command: name, args, ...(input == null ? {} : { input }) })}`); return ''; }
    return command(name, args, { ...env, ...extraEnv }, input);
  };
  state.coverage ??= {};
  state.stale ??= {};
  const cap = Number(env.ERROR_COLLECTOR_HOURLY_CAP ?? 5);
  if (!Number.isSafeInteger(cap) || cap < 0) throw new Error('invalid hourly cap');
  const noiseLimit = Number(env.ERROR_COLLECTOR_NOISE_HOURLY_LIMIT ?? 50);
  if (!Number.isSafeInteger(noiseLimit) || noiseLimit < 0) throw new Error('invalid noise hourly limit');
  const staleHours = Number(env.ERROR_COLLECTOR_STALE_HOURS ?? 2);
  const staleWindow = (Number.isFinite(staleHours) && staleHours > 0 ? staleHours : 2) * HOUR;
  state.noiseWindows ??= {};
  state.occurrences ??= {};
  const stats = (date, service) => {
    state.days[date] ??= {};
    return state.days[date][service] ??= { errors: 0, noise: 0, newGroups: 0, complete: false };
  };
  const absorb = (fp, group, observed = true) => {
    const known = state.fingerprints[fp];
    if (known) {
      if (group.incident && (!known.incident || group.incident.ts > known.incident.ts)) known.incident = group.incident;
      if (group.incident && !known.deleted) {
        for (const [id, occurrence] of Object.entries(group.occurrences ?? {})) state.occurrences[id] ??= { ...occurrence, ticket: known.ticket, queuedAt: iso(now) };
      }
      const newRoutes = group.routes.filter(route => route && !known.routes?.includes(route));
      known.routes = [...new Set([...(known.routes ?? []), ...group.routes])];
      known.total += group.count;
      known.firstSeen = known.firstSeen < group.firstSeen ? known.firstSeen : group.firstSeen;
      known.lastSeen = known.lastSeen > group.lastSeen ? known.lastSeen : group.lastSeen;
      if (!known.deleted && !group.incident) {
        const activity = state.activities[known.ticket] ??= { count: 0, since: group.firstSeen, at: known.lastActivityAt };
        activity.routes = [...new Set([...(activity.routes ?? []), ...newRoutes])];
        activity.count += group.count;
        activity.since = activity.since < group.firstSeen ? activity.since : group.firstSeen;
      }
    } else if (state.pending[fp]) {
      const pending = state.pending[fp];
      if (group.incident?.ts > pending.incident?.ts) pending.incident = group.incident;
      pending.count += group.count;
      pending.firstSeen = pending.firstSeen < group.firstSeen ? pending.firstSeen : group.firstSeen;
      pending.lastSeen = pending.lastSeen > group.lastSeen ? pending.lastSeen : group.lastSeen;
      pending.routes = [...new Set([...pending.routes, ...group.routes])];
      Object.assign(pending.occurrences ??= {}, group.occurrences);
      if (group.aliases) pending.aliases = [...new Set([...(pending.aliases ?? []), ...group.aliases])];
      if (group.noiseRule && group.hourlyCount > pending.hourlyCount) { pending.hourlyCount = group.hourlyCount; pending.hourLastSeen = group.hourLastSeen; }
    } else { state.pending[fp] = group; if (observed && !group.noiseRule) stats(day(group.firstSeen), group.service).newGroups++; }
  };
  let succeeded = 0;
  for (const source of sources ?? await loadSources()) {
    try {
      timeLeft(Infinity);
    } catch { diagnostic('run deadline reached; remaining sources deferred'); break; }
    try {
      const groups = new Map();
      const warnings = new Map();
      const revived = new Map();
      const previous = Date.parse(state.sources[source.name]);
      const since = iso(Math.max(now - DAY, Math.min(now, Number.isFinite(previous) ? previous : now - DAY)));
      const until = iso(now);
      const fetched = await bounded(source.fetch({ since, until, env, signal, cursor: structuredClone(state.sourceCursors?.[source.name]) }));
      timeLeft(Infinity);
      const rows = Array.isArray(fetched) ? fetched : fetched?.events;
      let cursor;
      if (!Array.isArray(fetched)) {
        const encoded = JSON.stringify(fetched?.cursor);
        if (encoded == null || Buffer.byteLength(encoded) > 4096) throw new Error('invalid source cursor');
        cursor = JSON.parse(encoded);
      }
      if (!Array.isArray(rows)) throw new Error('invalid source response');
      const events = correlate(rows.map(validate).filter(event => event.ts > since && event.ts <= until), [...Object.values(state.pending), ...Object.values(state.fingerprints)].filter(group => group.incident).map(group => group.incident));
      const boards = new Map();
      for (const event of events) {
        if (event.ticket === false) continue;
        const rule = noiseRule(event);
        const fp = rule?.alert ? noiseFingerprint(event.service, rule.id) : event.incident?.key ?? fingerprint(event.service, event.message, event.route);
        const board = state.fingerprints[fp]?.board ?? state.pending[fp]?.board ?? state.stale[fp]?.board ?? boards.get(fp);
        if (board == null) boards.set(fp, event.board);
        else event.board = board;
      }
      for (const event of events) {
        const counts = stats(day(event.ts), event.service);
        const rule = noiseRule(event);
        if (rule) counts.noise += event.count;
        else counts.errors += event.count;
        if (rule?.id === 'forced-test') diagnostic(`skipped forced test error from ${event.service} (${event.count})`);
        if (event.ticket === false) continue;
        const fp = rule?.alert ? noiseFingerprint(event.service, rule.id) : event.incident?.key ?? fingerprint(event.service, event.message, event.route);
        const stale = state.stale[fp] ?? revived.get(fp);
        if (stale) {
          if (event.ts <= stale.lastSeen) continue;
          revived.set(fp, stale);
          delete state.stale[fp];
        }
        if (rule) {
          if (rule.alert) {
            if (!warnings.has(fp)) warnings.set(fp, { rule, events: [] });
            warnings.get(fp).events.push({ board: event.board, service: event.service, ts: event.ts, count: event.count, message: redact(event.message).slice(0, 4000), route: redact(event.route), stack: redact(event.stack).split('\n').slice(0, 40).join('\n').slice(0, 12000) });
          }
          continue;
        }
        if (!groups.has(fp)) groups.set(fp, { rules: FINGERPRINT_RULES, board: event.board, service: event.service,normalized: redact(normalize(event.message)), message: redact(event.message).slice(0, 4000), stack: redact(event.stack).split('\n').slice(0, 40).join('\n').slice(0, 12000), routes: [], count: 0, firstSeen: event.ts, lastSeen: event.ts, ...(event.incident ? { incident: event.incident, aliases: [], occurrences: {} } : {}) });
        const group = groups.get(fp);
        if (event.incident) {
          const alias = fingerprint(event.service, event.message);
          if (!group.aliases.includes(alias)) group.aliases.push(alias);
          const id = createHash('sha256').update(JSON.stringify([event.incident.key, event.service, redact(event.route), normalize(event.message), since, until])).digest('hex').slice(0, 24);
          const occurrence = group.occurrences[id] ??= { count: 0 };
          occurrence.count += event.count;
          occurrence.text = `Occurrence window ${since} to ${until}: ${redact(event.route)}; ${redact(normalize(event.message))}; ${occurrence.count} hits. [error-occurrence:${id}]`;
        }
        merge(group, event);
      }
      for (const [fp, warning] of warnings) {
        const events = [...(state.noiseWindows[fp] ?? []), ...warning.events].sort((a, b) => a.ts.localeCompare(b.ts));
        let start = 0;
        let count = 0;
        let peak = 0;
        let lastSeen;
        for (let end = 0; end < events.length; end++) {
          count += events[end].count;
          while (Date.parse(events[start].ts) <= Date.parse(events[end].ts) - HOUR) count -= events[start++].count;
          if (count > peak) { peak = count; lastSeen = events[end].ts; }
        }
        state.noiseWindows[fp] = events.filter(event => Date.parse(event.ts) > now - HOUR);
        if (peak <= noiseLimit && !state.fingerprints[fp] && !state.pending[fp]) continue;
        const fresh = state.fingerprints[fp] || state.pending[fp] ? warning.events : events;
        const sample = fresh[0];
        const group = { board: sample.board, service: sample.service, noiseRule: warning.rule.id, normalized: warning.rule.name, message: sample.message, stack: sample.stack, routes: [], count: 0, firstSeen: sample.ts, lastSeen: sample.ts, hourlyCount: peak, hourLastSeen: lastSeen };
        for (const event of fresh) merge(group, event);
        groups.set(fp, group);
      }
      const prior = state.coverage[source.name];
      const continuous = prior && prior.until === state.sources[source.name] && previous >= Date.parse(since);
      const coverage = {
        since: continuous ? prior.since : since, until,
        services: [...new Set([...(prior?.services ?? []), source.name, ...events.map(event => event.service)])],
      };
      const start = Math.max(now - 13 * DAY, Number.isFinite(previous) ? Math.min(previous, Date.parse(since)) : Date.parse(since));
      for (let date = Date.parse(`${day(start)}T00:00:00Z`); date <= now; date += DAY) {
        for (const service of coverage.services) {
          const counts = stats(day(date), service);
          counts.complete = Date.parse(coverage.since) <= date && now >= date + DAY;
        }
      }
      state.coverage[source.name] = coverage;
      if (dryRun) console.log(`DRY-RUN source ${JSON.stringify({ name: source.name, since, until, events: events.length, count: events.reduce((sum, event) => sum + event.count, 0) })}`);
      for (const [fp, group] of groups) {
        if (revived.get(fp)?.aliases) group.aliases = revived.get(fp).aliases;
        absorb(fp, group);
      }
      state.sources[source.name] = until;
      if (!Array.isArray(fetched)) (state.sourceCursors ??= {})[source.name] = cursor;
      await checkpoint();
      succeeded++;
    } catch { diagnostic(`source ${/^[a-z][a-z0-9-]*$/.test(source.name) ? source.name : '[invalid]'} failed; cursor unchanged`); }
  }
  if (dryRun) console.log(`DRY-RUN counts ${JSON.stringify(state.days)}`);
  if (!succeeded) return 1;
  for (const [fp, events] of Object.entries(state.noiseWindows)) {
    state.noiseWindows[fp] = events.filter(event => Date.parse(event.ts) > now - HOUR);
    if (!state.noiseWindows[fp].length) delete state.noiseWindows[fp];
  }
  state.created = state.created.filter(time => Date.parse(time) > now - HOUR);
  for (const date of Object.keys(state.days)) if (date < day(now - 13 * DAY)) delete state.days[date];
  for (const date of Object.keys(state.summaries)) if (date < day(now - 13 * DAY)) delete state.summaries[date];
  for (const [fp, record] of Object.entries(state.stale)) if (day(record.lastSeen) < day(now - 13 * DAY)) delete state.stale[fp];
  for (const [fp, group] of Object.entries(state.pending)) {
    if (group.noiseRule || group.incident) continue;
    const route = group.routes.find(value => value.startsWith('/api/')) ?? group.routes[0];
    const incident = incidentOf({ message: group.message, stack: group.stack, route });
    if (!incident?.root) continue;
    const id = createHash('sha256').update(`${fp}|${group.firstSeen}`).digest('hex').slice(0, 24);
    delete state.pending[fp];
    absorb(incident.key, { ...group, incident: { ...incident, ts: group.lastSeen }, aliases: [...new Set([...(group.aliases ?? []), fp])], occurrences: { [id]: { text: `Retained occurrence ${group.firstSeen}: ${group.count} hits; ${incident.root}. [error-occurrence:${id}]` } } }, false);
  }
  for (const [fp, group] of Object.entries(state.pending)) {
    if (group.noiseRule || group.rules === FINGERPRINT_RULES) continue;
    group.rules = FINGERPRINT_RULES;
    if (!changedByCurrentRules(group.message)) continue;
    const current = fingerprint(group.service, group.message);
    if (current === fp) continue;
    delete state.pending[fp];
    absorb(current, { ...group, aliases: [...new Set([...(group.aliases ?? []), fp])], normalized: redact(normalize(group.message)) }, false);
  }
  await checkpoint();
  let held = 0;
  let section;
  for (const [fp, group] of Object.entries(state.pending)) {
    if (signal.aborted) break;
    try {
      let found = search(fp, group.board, env);
      for (const alias of group.aliases ?? []) found ??= search(alias, group.board, env, group.incident);
      if (!found && group.incident) {
        const allowWrapper = !Object.values(state.pending).some(other => other.incident?.routeKey === group.incident.routeKey && other.incident.root !== group.incident.root && Math.abs(Date.parse(other.firstSeen) - Date.parse(group.firstSeen)) <= 10 * 60_000);
        found = findRelatedIncident({ ...group, allowWrapper }, env);
        if (found?.prior && Object.values(state.fingerprints).some(record => record.ticket === found.ticket && record.incident?.root && record.incident.root !== group.incident.root)) found = undefined;
      }
      if (!found) {
        if (now - Date.parse(group.lastSeen) > staleWindow) {
          const target = Object.values(state.fingerprints).find(record => record.ticket && !record.deleted && record.board === group.board && group.routes.some(route => route && record.routes?.includes(route)));
          state.stale[fp] = { board: group.board, service: group.service, firstSeen: group.firstSeen, lastSeen: group.lastSeen, count: group.count, routes: group.routes, aliases: group.aliases ?? [] };
          if (target) {
            const activity = state.activities[target.ticket] ??= { count: 0, since: group.firstSeen, at: target.lastActivityAt };
            const stale = activity.stale ??= { count: 0, firstSeen: group.firstSeen, lastSeen: group.lastSeen };
            stale.count += group.count;
            stale.firstSeen = stale.firstSeen < group.firstSeen ? stale.firstSeen : group.firstSeen;
            stale.lastSeen = stale.lastSeen > group.lastSeen ? stale.lastSeen : group.lastSeen;
          } else {
            const counts = stats(day(now), group.service);
            counts.stale = (counts.stale ?? 0) + 1;
          }
          if (dryRun) console.log(`DRY-RUN stale ${JSON.stringify({ fingerprint: fp, lastSeen: group.lastSeen, outcome: target ? 'stale sighting' : 'stale, not filed', ticket: target?.ticket })}`);
          delete state.pending[fp];
          await checkpoint();
          continue;
        }
        if (state.created.length >= cap) { held++; continue; }
        const column = group.board === 15 ? '4389' : (section ??= intake(env));
        const text = description(group, fp);
        let temp;
        const path = dryRun ? '<tmp-description.html>' : join(root, `.description-${randomUUID()}.html`);
        try {
          if (!dryRun) { temp = path; await fs.writeFile(path, text, { mode: 0o600, flag: 'wx' }); }
          state.created.push(iso(now));
          await checkpoint();
          const output = write('vcc', ['--json', 'task', 'create', '--project', String(group.board), '--section', column, '--labels', 'Error Log', '--priority', 'high', '--title', group.noiseRule ? `${group.service}: ${group.normalized} repeated ${group.hourlyCount} times in one hour` : `${group.service}: ${group.normalized.slice(0, 150)}`, '--description-file', path], undefined, { VCC_VOICE_BYPASS: 'error collector raw evidence' });
          if (dryRun) { console.log(`DRY-RUN description ${JSON.stringify(text)}`); found = { ticket: `DRYRUN-${state.created.length}`, deleted: false }; }
          else found = { ticket: ticketRef(payload(output).task), deleted: false };
          state.fingerprints[fp] = { ...found, board: group.board, firstSeen: group.firstSeen, lastSeen: group.lastSeen, total: group.count, routes: group.routes, incident: group.incident, lastActivityAt: iso(now) };
        } finally { if (temp) await fs.rm(temp, { force: true }); }
      } else {
        state.fingerprints[fp] = { ...found, board: group.board, firstSeen: group.firstSeen, lastSeen: group.lastSeen, total: group.count, routes: group.routes, incident: group.incident, lastActivityAt: null };
        if (!found.deleted && !group.incident) {
          const activity = state.activities[found.ticket] ??= { count: 0, since: group.firstSeen, at: null };
          activity.routes = [...new Set([...(activity.routes ?? []), ...group.routes.filter(Boolean)])];
          activity.count += group.count;
          activity.since = activity.since < group.firstSeen ? activity.since : group.firstSeen;
        }
      }
      if (group.incident && !found.deleted) {
        for (const [id, occurrence] of Object.entries(group.occurrences)) state.occurrences[id] ??= { ...occurrence, ticket: found.ticket, queuedAt: iso(now) };
        if (found.prior) {
          const id = createHash('sha256').update(`${found.ticket}|${found.prior}`).digest('hex').slice(0, 24);
          state.occurrences[id] ??= { ticket: found.ticket, queuedAt: iso(now), text: `Original MCP report ${found.prior}; correlated with ${group.incident.root}. [error-occurrence:${id}]` };
        }
      }
      delete state.pending[fp];
      await checkpoint();
    } catch { diagnostic(`group ${fp} reporting failed; kept pending`); }
  }
  for (const [id, occurrence] of Object.entries(state.occurrences)) {
    if (signal.aborted) break;
    try {
      const page = payload(command('ht', ['GET', `/mcp/tasks/${occurrence.ticket}/agent-activity?limit=100`], env));
      if (!Array.isArray(page.activities)) throw new Error('invalid occurrence activity page');
      if (!page.activities.some(activity => activity.text?.includes(`[error-occurrence:${id}]`))) {
        if (page.activities.length === 100 && page.activities.every(activity => Date.parse(activity.createdAt) >= Date.parse(occurrence.queuedAt))) throw new Error('occurrence activity history truncated');
        write('vcc', ['activity', 'add', occurrence.ticket, occurrence.text]);
      }
      delete state.occurrences[id];
      await checkpoint();
    } catch { diagnostic('occurrence activity failed; retry next run'); }
  }
  for (const [ticket, activity] of Object.entries(state.activities)) {
    if (signal.aborted) break;
    const records = Object.values(state.fingerprints).filter(record => record.ticket === ticket);
    const lastActivity = Math.max(0, Date.parse(activity.at) || 0, ...records.map(record => Date.parse(record.lastActivityAt) || 0));
    if ((!activity.count && !activity.stale?.count) || records.some(record => record.deleted) || now - lastActivity < 6 * HOUR) continue;
    const total = records.reduce((sum, record) => sum + record.total, 0);
    const lastSeen = records.map(record => record.lastSeen).sort().at(-1);
    try {
      const routes = (activity.routes ?? []).slice(0, 3).map(route => route.trim().slice(0, 120)).join(', ');
      const stale = activity.stale ? `; stale sighting: ${activity.stale.count} occurrences, first seen ${activity.stale.firstSeen}, last seen ${activity.stale.lastSeen}` : '';
      write('vcc', ['activity', 'add', ticket, `${activity.count} more since ${activity.since}, ${total} total, last seen ${lastSeen}${routes ? `; new routes: ${routes}` : ''}${stale}`]);
      delete activity.stale;
      activity.count = 0;
      activity.routes = [];
      activity.since = iso(now);
      activity.at = iso(now);
      for (const record of records) record.lastActivityAt = iso(now);
      await checkpoint();
    } catch { diagnostic('activity failed; retry next run'); }
  }
  if (held && !signal.aborted) {
    try { write('vcc', ['activity', 'add', CONTROL, `${held} error groups held back by the hourly cap`]); }
    catch { diagnostic('held-back notice failed'); }
  }
  if (!signal.aborted && (summary || new Date(now).getUTCHours() >= 6)) {
    const services = new Set(Object.values(state.days).flatMap(counts => Object.keys(counts)));
    const dayEnd = date => Date.parse(`${date}T00:00:00Z`) + DAY;
    const covered = (date, service) => state.days[date]?.[service]?.complete === true;
    const finalized = (date, service) => Object.values(state.coverage).some(coverage => coverage.services.includes(service) && Date.parse(coverage.until) >= dayEnd(date));
    const due = (date, service) => !state.summaries[date]?.[service] && (covered(date, service) || finalized(date, service) || now - dayEnd(date) >= 2 * DAY);
    const dates = Object.keys(state.days).filter(date => date < day(now) && [...services].some(service => due(date, service))).sort().slice(0, 3);
    for (const date of dates) {
      const previousDate = day(Date.parse(`${date}T00:00:00Z`) - DAY);
      for (const service of services) {
        if (signal.aborted) break;
        if (!due(date, service)) continue;
        const counts = stats(date, service);
        const previous = covered(previousDate, service) ? state.days[previousDate][service].errors : null;
        const text = (covered(date, service)
          ? `${service} on ${date}: ${counts.errors} errors (${previousDate}: ${previous ?? 'no complete data'}), ${counts.newGroups} new kinds, ${counts.noise} noise`
          : `${service} on ${date}: no complete data, ${finalized(date, service) ? 'collection did not cover the full day' : 'the source kept failing'} (partial count ${counts.errors})`) + (counts.stale ? `, ${counts.stale} stale, not filed` : '');
        try {
          write('vcc', ['activity', 'add', CONTROL, text]);
          if (covered(date, service) && previous !== null && counts.errors > 3 * previous && counts.errors >= 50) {
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
    for (const name of ['collector.mjs', 'io.mjs', 'noise.json', 'incident.mjs']) await fs.copyFile(join(HERE, name), join(target, name));
    await fs.cp(join(HERE, 'sources'), join(target, 'sources'), { recursive: true });
  }
  const checker = join(HERE, HERE === target ? '' : '..', 'user-unit-check');
  if (checker !== join(target, 'user-unit-check')) await fs.copyFile(checker, join(target, 'user-unit-check'));
  await fs.chmod(join(target, 'user-unit-check'), 0o755);
  await fs.chmod(join(target, 'collector.mjs'), 0o755);
  for (const suffix of ['service', 'timer']) {
    const name = `error-collector.${suffix}`;
    if (HERE !== target) await fs.copyFile(join(HERE, '..', name), join(target, name));
    await fs.copyFile(join(target, name), join(units, name));
  }
  command(env.USER_UNIT_CHECK || join(target, 'user-unit-check'), [join(units, 'error-collector.service'), join(units, 'error-collector.timer')], env);
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
