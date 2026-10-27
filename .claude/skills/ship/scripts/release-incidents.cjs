#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const PREFIX = '[INCIDENT] Shared required checks';
const text = row => (row.text || row.commentText || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const author = row => row.agent || { id: row.agentId, displayName: row.agentName };
const order = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
  Number(typeof a.id !== 'number') - Number(typeof b.id !== 'number') ||
  (typeof a.id === 'number' && typeof b.id === 'number' ? a.id - b.id : String(a.id).localeCompare(String(b.id)));
function session(value) {
  const resume = value.match(/(?:--resume|\bresume)\s+([^\s]+)/);
  if (resume) return `resume:${resume[1]}`;
  const tmux = value.match(/tmux attach -t ([^\s]+)/);
  return tmux ? `tmux:${tmux[1]}` : '';
}
function liveClaims(rows, { reference = Date.now(), idle, assigned = [], mine = reference } = {}) {
  const sorted = [...rows].filter(row => author(row)?.id).sort(order);
  return sorted.filter(row => text(row).includes('Claimed.') &&
    !sorted.some(next => order(next, row) > 0 && author(next).id === author(row).id &&
      /^(Handing over|Handed over|Stepping back|Released|Unclaimed)\b/i.test(text(next)) &&
      (!session(text(next)) || session(text(next)) === session(text(row)))) &&
    (!assigned.length || assigned.includes(author(row).id) || Date.parse(row.createdAt) > mine - 300000) &&
    (Date.parse(row.createdAt) >= reference - 21600000 || (idle ? !idle.includes(author(row).id) :
      sorted.some(next => author(next).id === author(row).id && Date.parse(next.createdAt) >= reference - 21600000))));
}
function owner(rows, now = Date.now()) {
  const row = liveClaims(rows, { reference: now })[0];
  return row ? { id: author(row).id, name: author(row).displayName, session: session(text(row)) } : null;
}
function decide(resumeId, value, idle, assigned) {
  const rows = [...value.comments, ...(value.activities || [])];
  const ours = rows.filter(row => text(row).includes(resumeId));
  const mine = Math.min(...ours.map(row => Date.parse(row.createdAt)));
  const claims = liveClaims(rows, { reference: mine, mine, idle: [], assigned });
  const me = claims.find(row => text(row).includes(resumeId));
  if (!me) return 'NOOURS';
  const other = claims.find(row => !text(row).includes(resumeId) && order(row, me) < 0 &&
    (Date.parse(me.createdAt) - Date.parse(row.createdAt) <= 21600000 || !idle.includes(author(row).id)));
  if (!other) return 'WIN';
  return ['LOSE', author(other).displayName || author(other).id, author(other).id,
    Number(Date.parse(me.createdAt) - Date.parse(other.createdAt) > 21600000), Number(author(other).id === author(me).id)].join('\t');
}
function incidents(tasks) {
  return tasks.filter(task => task.title.startsWith(PREFIX) && task.status !== 'Deleted' &&
    !['Done', 'Archive', 'Archived'].includes(task.section));
}
function allowed(tasks, logs, name, ticket, now = Date.now(), resume = '') {
  return incidents(tasks).every(task => {
    if (task.ticketNumber === ticket) return true;
    const claimed = owner(logs[task.ticketNumber] || [], now);
    return claimed?.name?.toLowerCase() === name.toLowerCase() && !!claimed.session && claimed.session === session(resume);
  });
}
function command(bin, args) {
  const executable = bin === 'hypertask' ? process.env.SHIP_CLAIM_HYPERTASK || bin : bin === 'ht' ? process.env.SHIP_CLAIM_HT || bin : bin;
  return execFileSync(executable, args, { encoding: 'utf8', timeout: 25000, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}
function pages(bin, args, key, run = command) {
  const rows = [], seen = new Set();
  let cursor;
  do {
    const data = JSON.parse(run(bin, [...args, ...(cursor ? ['--cursor', cursor] : []), '--json']));
    if (data.success !== true || !Array.isArray(data[key])) throw new Error(`Unreadable ${key}`);
    rows.push(...data[key]);
    cursor = data.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Repeated board cursor');
    seen.add(cursor);
    if (!cursor && Number.isInteger(data.total) && data.total > rows.length) throw new Error('Incomplete board history');
  } while (cursor);
  return rows;
}
function logs(ticket, run = command) {
  const comments = pages('hypertask', ['comment', 'list', ticket, '--limit', '100'], 'comments', run);
  const activities = [], seen = new Set();
  let cursor;
  do {
    const data = JSON.parse(run('ht', ['GET', `/mcp/tasks/${ticket}/agent-activity?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`]));
    if (data.success !== true || !Array.isArray(data.activities)) throw new Error('Unreadable claim activity');
    if (data.activities.length === 100 && data.nextCursor === undefined) throw new Error('Incomplete claim activity; server pagination unavailable');
    activities.push(...data.activities);
    cursor = data.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Repeated activity cursor');
    seen.add(cursor);
  } while (cursor);
  return [...comments, ...activities];
}
function guard(ticket, run = command, resume = process.env.SHIP_CLAIM_RESUME || '') {
  const tasks = pages(process.env.SHIP_CLAIM_HYPERTASK || 'hypertask', ['tasks', 'list', '--project', '4060', '--status', 'Normal', '--limit', '500'], 'tasks', run);
  const open = incidents(tasks);
  if (!open.length || open.some(task => task.ticketNumber === ticket)) return true;
  const name = process.env.SHIP_SESSION_NAME;
  if (!name) throw new Error('Missing runner identity');
  const existing = owner(logs(ticket, run));
  if (existing?.name?.toLowerCase() === name.toLowerCase() && !!existing.session && existing.session === session(resume)) return true;
  const claims = Object.fromEntries(open.map(task => [task.ticketNumber, logs(task.ticketNumber, run)]));
  if (allowed(open, claims, name, ticket, Date.now(), resume)) return true;
  console.error(`ship-claim: STEP BACK; shared-check incident open: ${open.map(task => `https://app.hypertask.ai/detail/project-4060/${task.uniqueIndex}`).join(' ')}; only its live claimant may pick new tickets`);
  return false;
}
module.exports = { PREFIX, owner, session, decide, incidents, allowed, command, pages, logs, guard };
if (require.main === module) {
  try {
    if (process.argv[2] === 'guard') process.exitCode = guard(process.argv[3], command, process.argv[4]) ? 0 : 3;
    else if (process.argv[2] === 'decide') {
      const readIds = file => file ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
      console.log(decide(process.argv[3], JSON.parse(fs.readFileSync(process.argv[4], 'utf8')), readIds(process.argv[5]), readIds(process.argv[6])));
    }
    else if (process.argv[2] === 'owners') {
      const { tasks, logs: supplied, now } = JSON.parse(fs.readFileSync(0, 'utf8'));
      console.log(JSON.stringify(incidents(tasks).map(task => ({ ticket: task.ticketNumber,
        owner: owner(supplied ? supplied[task.ticketNumber] || [] : logs(task.ticketNumber), now) }))));
    } else throw new Error('usage: release-incidents.cjs guard TICKET | owners');
  } catch (error) { console.error(`release-incidents: ${error.message}`); process.exitCode = 2; }
}
