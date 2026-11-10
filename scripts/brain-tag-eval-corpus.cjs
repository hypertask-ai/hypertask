#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BOARD = 15;
const LIMIT = 200;
const CUTOFF = '2026-11-10T00:00:00Z';
const OUT = path.resolve(__dirname, '../tests/fixtures/brain-tag-eval/corpus.json');
const TIMESTAMPS = path.resolve(__dirname, '../tests/fixtures/brain-tag-eval/timestamps.json');
const CLIENTS = [/\binne\b/gi, /\bwazig\b/gi, /\bWazi[gG]\b/g, /\bfuneral\b/gi, /\b1st ?formations?\b/gi, /\bFirst Formations?\b/gi];
const QUOTA = { 'brain-light': 57, 'brain-medium': 105, 'brain-hard': 36, 'brain-extra-hard': 2 };

function list(status) {
  const rows = [];
  for (let offset = 0; offset < 600; offset += 100) {
    const args = ['--json', 'task', 'list', '--project', String(BOARD), '--labels', 'brain-light,brain-medium,brain-hard,brain-extra-hard', '--limit', '100', '--offset', String(offset)];
    if (status) args.push('--status', status);
    const page = JSON.parse(execFileSync(process.env.HYPERTASK_BIN || 'hypertask', args, { maxBuffer: 64 << 20 }).toString());
    const tasks = page.tasks ?? [];
    rows.push(...tasks);
    if (tasks.length < 100) break;
  }
  return rows;
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" };

function clean(html) {
  let text = String(html ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x27|#39|nbsp|amp|lt|gt|quot);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
  for (const name of CLIENTS) text = text.replace(name, 'a client');
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'an email');
}

function firstNote(text, max = 1000) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max * 0.6 ? space : max)}...`;
}

function goldBrain(task) {
  const names = (task.labels ?? []).map((label) => String(label.name ?? label).trim().toLowerCase());
  return names.find((name) => Object.hasOwn(QUOTA, name)) ?? null;
}

function main() {
  const rows = [...list(null), ...list('Archive')];
  const seen = new Set();
  const eligible = rows.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    const gold = goldBrain(task);
    return gold && QUOTA[gold] !== undefined && task.createdAt < CUTOFF && task.updatedAt < CUTOFF;
  });
  const byClass = new Map(Object.keys(QUOTA).map((name) => [name, []]));
  for (const task of eligible.sort((a, b) => a.uniqueIndex - b.uniqueIndex)) byClass.get(goldBrain(task)).push(task);
  const cases = [];
  const stamps = new Map();
  for (const [gold, quota] of Object.entries(QUOTA)) {
    const pool = byClass.get(gold);
    const step = pool.length / Math.min(quota, pool.length);
    const picked = new Set();
    for (let i = 0; i < Math.min(quota, pool.length); i++) picked.add(Math.floor(i * step));
    for (let i = 0; picked.size < Math.min(quota, pool.length) && i < pool.length; i++) picked.add(i);
    for (const index of [...picked].sort((a, b) => a - b)) {
      const task = pool[index];
      if (!task) continue;
      const text = firstNote(clean(task.description));
      if (text.length < 40) continue;
      cases.push({ id: task.ticketNumber, title: clean(task.title), text, gold });
      stamps.set(task.ticketNumber, { createdAt: task.createdAt, updatedAt: task.updatedAt });
    }
  }
  const corpus = {
    generatedAt: new Date().toISOString(),
    boardId: BOARD,
    source: `hypertask task list --project ${BOARD} --labels brain-* (Normal + Archive)`,
    excluded: {
      createdOnOrAfter: CUTOFF,
      reason: 'The Task Writer brain tag shipped to board 15 testers on 2026-11-10. A brain label cannot be written without touching the task, so a task created and last updated before the cutoff carries a label that predates the writer.',
    },
    classes: Object.keys(QUOTA),
    cases,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(corpus, null, 2)}\n`);
  fs.writeFileSync(TIMESTAMPS, `${JSON.stringify({ cutoff: CUTOFF, cases: Object.fromEntries(stamps) }, null, 2)}\n`);
  console.log(`wrote ${cases.length} cases to ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main();
module.exports = { clean, firstNote, goldBrain, QUOTA, TIMESTAMPS };
