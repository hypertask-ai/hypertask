#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { command, pages, logs, liveClaims, text } = require('./release-incidents.cjs');
const ready = new Set(['Bugs', 'Todo', 'Improvements', 'Backlog']);
const priorities = ['Urgent', 'High', 'Medium', 'Low'];
function candidates(tasks) {
  return tasks.filter(task => task.status !== 'Deleted' && task.status !== 'Archive' && ready.has(task.section) &&
    !task.agent?.id && !(task.assignees || []).some(row => row.agent?.id || /abdul/i.test(row.displayName || '')))
    .sort((a, b) => (priorities.indexOf(a.priority) + 1 || 5) - (priorities.indexOf(b.priority) + 1 || 5));
}
function pick(resume, run = command, claim = (ticket) => spawnSync(path.join(__dirname, 'ship-claim'), [ticket, resume],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 180000 }).status) {
  if (!resume) throw new Error('Missing claim resume command');
  const groups = [
    ['4060', '--priority', 'urgent'],
    ['15'],
    ['4060'],
  ];
  const seen = new Set();
  for (const [project, ...filter] of groups) {
    const tasks = pages('hypertask', ['tasks', 'list', '--project', project, '--status', 'Normal', '--limit', '100', ...filter], 'tasks', run);
    for (const task of candidates(tasks)) {
      if (!/^(HTPR|HYFA|YPER4)-\d+$/.test(task.ticketNumber)) throw new Error('Invalid ticket number');
      if (seen.has(task.ticketNumber)) continue;
      seen.add(task.ticketNumber);
      const fresh = JSON.parse(run('hypertask', ['tasks', 'get', task.ticketNumber, '--json']));
      if (fresh.success !== true || !Array.isArray(fresh.tasks) || fresh.tasks.length !== 1) throw new Error('Unreadable candidate');
      if (!candidates(fresh.tasks).length || fresh.tasks[0].projectId !== Number(project) ||
        (filter.length && fresh.tasks[0].priority !== 'Urgent')) continue;
      const history = logs(task.ticketNumber, run).filter(row => !/^(Product Bot|Dev \d|Feature Dev|QA \d|Supervisor|worker|drain)\b/i.test(row.agent?.displayName || ''));
      if (liveClaims(history, { reference: 0 }).length || history.some(row => /^Question:/i.test(text(row)))) continue;
      const status = claim(task.ticketNumber);
      if (status === 3) continue;
      if (status !== 0) throw new Error(`Claim failed for ${task.ticketNumber}`);
      return task.ticketNumber;
    }
  }
  return null;
}
module.exports = { candidates, pick };
if (require.main === module) {
  try {
    const ticket = pick(process.argv[2] || process.env.SHIP_CLAIM_RESUME);
    if (ticket) console.log(ticket);
    else process.exitCode = 4;
  } catch (error) { console.error(`runner-pick: ${error.message}`); process.exitCode = 2; }
}
