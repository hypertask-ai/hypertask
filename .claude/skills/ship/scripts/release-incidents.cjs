#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const PREFIX = '[INCIDENT] Shared required checks';
const text = row => (row.text || row.commentText || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const author = row => row.agent || { id: row.agentId, displayName: row.agentName };
const order = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
function owner(rows, now = Date.now()) {
  const sorted = [...rows].sort(order);
  return sorted.filter(row => author(row)?.id && text(row).startsWith('Claimed.') &&
    !sorted.some(next => order(next, row) > 0 && author(next)?.id === author(row).id &&
      /^(Handing over|Handed over|Stepping back|Released|Unclaimed)\b/i.test(text(next))) &&
    sorted.some(next => author(next)?.id === author(row).id && Date.parse(next.createdAt) >= now - 21600000))
    .map(row => ({ id: author(row).id, name: author(row).displayName }))[0] || null;
}
function incidents(tasks) {
  return tasks.filter(task => task.title.startsWith(PREFIX) && task.status !== 'Deleted' &&
    !['Done', 'Archive', 'Archived'].includes(task.section));
}
function allowed(tasks, logs, name, ticket, now = Date.now()) {
  return incidents(tasks).every(task => task.ticketNumber === ticket ||
    owner(logs[task.ticketNumber] || [], now)?.name?.toLowerCase() === name.toLowerCase());
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
  const data = JSON.parse(run('ht', ['GET', `/mcp/tasks/${ticket}/agent-activity?limit=100`]));
  if (data.success !== true || !Array.isArray(data.activities) || data.activities.length === 100) {
    throw new Error('Incomplete claim activity; refusing an ownership guess');
  }
  const activities = data.activities;
  return [...comments, ...activities];
}
function guard(ticket, run = command) {
  const tasks = pages(process.env.SHIP_CLAIM_HYPERTASK || 'hypertask', ['tasks', 'list', '--project', '4060', '--status', 'Normal', '--limit', '500'], 'tasks', run);
  const open = incidents(tasks);
  if (!open.length || open.some(task => task.ticketNumber === ticket)) return true;
  const name = process.env.SHIP_SESSION_NAME;
  if (!name) throw new Error('Missing runner identity');
  const claims = Object.fromEntries(open.map(task => [task.ticketNumber, logs(task.ticketNumber, run)]));
  if (allowed(open, claims, name, ticket)) return true;
  const existing = owner(logs(ticket, run));
  if (existing?.name?.toLowerCase() === name.toLowerCase()) return true;
  console.error(`ship-claim: STEP BACK; shared-check incident open: ${open.map(task => `https://app.hypertask.ai/detail/project-4060/${task.uniqueIndex}`).join(' ')}; only its live claimant may pick new tickets`);
  return false;
}
module.exports = { PREFIX, owner, incidents, allowed, command, pages, logs, guard };
if (require.main === module) {
  try {
    if (process.argv[2] === 'guard') process.exitCode = guard(process.argv[3]) ? 0 : 3;
    else if (process.argv[2] === 'owners') {
      const { tasks, logs, now } = JSON.parse(fs.readFileSync(0, 'utf8'));
      console.log(JSON.stringify(incidents(tasks).map(task => ({ ticket: task.ticketNumber, owner: owner(logs[task.ticketNumber] || [], now) }))));
    } else throw new Error('usage: release-incidents.cjs guard TICKET | owners');
  } catch (error) { console.error(`release-incidents: ${error.message}`); process.exitCode = 2; }
}
