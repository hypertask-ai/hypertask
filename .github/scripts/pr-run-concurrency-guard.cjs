#!/usr/bin/env node
// A push that supersedes an older one on the same pull request must cancel the
// older run, or the extra jobs sit in the queue behind the newest push
// (YPER4-663: 108 queued jobs, oldest wait 2.5 h).
//
// Gates that publish a required status are excluded on purpose: a cancelled run
// leaves that status unresolved. They keep `queue: max` instead, so a newer
// event never drops an older pending run.
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const EXCEPTIONS = new Map([
  ['feature-flag-gate', 'shared production line with queue: max; cancelling leaves the required gate status unresolved (YPER4-707)'],
  ['ux-signoff-gate', 'shared production line with queue: max; cancelling leaves the signoff status unresolved (YPER4-707)'],
  ['pr-guards-trusted', 'publishes the required pr-title status with queue: max; a cancelled evaluation leaves it pending (HYCI-29)'],
]);

const PUSH_EVENTS = ['pull_request', 'pull_request_target'];
// `synchronize` is the push event; without it a workflow never has a superseded run.
const PUSH_TYPE = 'synchronize';
// Only an expression can name the pull request, so a group without one is shared.
const PER_PULL_REQUEST = /github\.event\.pull_request\.number|github\.head_ref|github\.ref(?!\w)/;

function lines(text) {
  return text.split('\n');
}

function block(entries) {
  const body = [];
  for (const line of entries) {
    if (line.trim() && !line.startsWith(' ')) break;
    body.push(line);
  }
  return body;
}

function section(text, key) {
  const all = lines(text);
  const start = all.findIndex(line => line.trimEnd() === `${key}:`);
  return start < 0 ? [] : block(all.slice(start + 1));
}

function eventTypes(onBody) {
  const found = new Map();
  for (const event of PUSH_EVENTS) {
    const start = onBody.findIndex(line => line.trimEnd() === `  ${event}:`);
    if (start < 0) continue;
    const body = block(onBody.slice(start + 1));
    const at = body.findIndex(line => line.trimStart().startsWith('types:'));
    if (at < 0) {
      found.set(event, [PUSH_TYPE]);
      continue;
    }
    const inline = body[at].slice(body[at].indexOf(':') + 1).match(/[\w-]+/g);
    if (inline) {
      found.set(event, inline);
      continue;
    }
    const listed = [];
    for (const line of body.slice(at + 1)) {
      const entry = line.trim();
      if (!entry.startsWith('-')) break;
      listed.push(...entry.slice(1).match(/[\w-]+/g) || []);
    }
    found.set(event, listed.length ? listed : [PUSH_TYPE]);
  }
  return found;
}

function value(concurrency, key) {
  const line = concurrency.find(entry => entry.trimStart().startsWith(`${key}:`));
  return line === undefined ? undefined : line.slice(line.indexOf(':') + 1).split('#')[0].trim();
}

function cancelInProgress(concurrency) {
  const raw = value(concurrency, 'cancel-in-progress');
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const inner = raw.replace(/^\$\{\{/, '').replace(/\}\}$/, '').trim();
  if (/^(?:false|0|null|''|""|\s*)$/.test(inner)) return false;
  return raw;
}

function problemsFor(name, text) {
  const onBody = section(text, 'on');
  const types = eventTypes(onBody);
  const pushes = [...types.values()].some(list => list.includes(PUSH_TYPE));
  if (!pushes) return [];
  if (EXCEPTIONS.has(name)) return [];
  const concurrency = section(text, 'concurrency');
  if (!concurrency.length) return [`${name}: no concurrency block`];
  const problems = [];
  const group = value(concurrency, 'group') || '';
  const inner = group.replace(/^\$\{\{/, '').replace(/\}\}$/, '');
  if (!group.includes('${{') || !PER_PULL_REQUEST.test(inner)) {
    problems.push(`${name}: concurrency group ${group || '(empty)'} is not per pull request`);
  }
  const cancel = cancelInProgress(concurrency);
  if (cancel !== true && typeof cancel !== 'string') {
    problems.push(`${name}: cancel-in-progress is ${value(concurrency, 'cancel-in-progress') === undefined ? 'missing' : 'false'}`);
  }
  return problems;
}

function check(directory) {
  const problems = [];
  for (const file of readdirSync(directory)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const name = path.basename(file).replace(/\.ya?ml$/, '');
    problems.push(...problemsFor(name, readFileSync(path.join(directory, file), 'utf8')));
  }
  return problems;
}

function main(argv) {
  const [directory = '.github/workflows'] = argv.filter(arg => !arg.startsWith('--'));
  if (argv.includes('--list-exceptions')) {
    console.log(`exceptions: ${[...EXCEPTIONS.keys()].join(' ')}`);
    return 0;
  }
  const problems = check(directory);
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    return 1;
  }
  console.log('pr run concurrency guard passed');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { EXCEPTIONS, check, problemsFor };
