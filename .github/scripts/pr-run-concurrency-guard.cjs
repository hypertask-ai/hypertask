#!/usr/bin/env node
// A push that supersedes an older one on the same pull request must cancel the
// older run, or the extra jobs sit in the queue behind the newest push
// (YPER4-663: 108 queued jobs, oldest wait 2.5 h).
//
// Two gates are excluded on purpose: they run trusted production code on one
// shared line, and a cancelled run leaves their required status unresolved
// (YPER4-707). They keep `queue: max` instead, so a newer event never drops an
// older pending run.
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const EXCEPTIONS = new Map([
  ['feature-flag-gate', 'shared production line with queue: max; cancelling leaves the required gate status unresolved (YPER4-707)'],
  ['ux-signoff-gate', 'shared production line with queue: max; cancelling leaves the signoff status unresolved (YPER4-707)'],
]);

const PER_PULL_REQUEST_KEYS = ['github.event.pull_request.number', 'github.head_ref', 'github.ref'];

function section(text, key) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.trimEnd() === `${key}:`);
  if (start < 0) return '';
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(' ') && !line.startsWith('#')) break;
    body.push(line);
  }
  return body.join('\n');
}

function pullRequestPushTypes(on) {
  const lines = on.split('\n');
  const start = lines.findIndex(line => line.trimEnd() === '  pull_request:');
  if (start < 0) return null;
  const typesLine = lines.slice(start + 1).find(line => line.trimStart().startsWith('types:'));
  // No explicit types means GitHub's default set, which includes synchronize.
  if (!typesLine) return ['synchronize'];
  return typesLine.match(/[\w-]+/g).filter(token => token !== 'types');
}

function cancelInProgress(concurrency) {
  const line = concurrency.split('\n').find(entry => entry.trimStart().startsWith('cancel-in-progress:'));
  if (!line) return undefined;
  const value = line.slice(line.indexOf(':') + 1).split('#')[0].trim();
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  return value;
}

function problemsFor(name, text) {
  const on = section(text, 'on');
  const pushTypes = pullRequestPushTypes(on);
  if (!pushTypes || !pushTypes.includes('synchronize')) return [];
  if (EXCEPTIONS.has(name)) return [];
  const concurrency = section(text, 'concurrency');
  const problems = [];
  if (!concurrency) return [`${name}: no concurrency block`];
  const group = concurrency.split('\n').find(entry => entry.trimStart().startsWith('group:'));
  const groupValue = group ? group.slice(group.indexOf(':') + 1).trim() : '';
  if (!PER_PULL_REQUEST_KEYS.some(key => groupValue.includes(key))) {
    problems.push(`${name}: concurrency group ${groupValue || '(empty)'} is not per pull request`);
  }
  const cancel = cancelInProgress(concurrency);
  if (cancel !== true && typeof cancel !== 'string') {
    problems.push(`${name}: cancel-in-progress is ${cancel === false ? 'false' : 'missing'}`);
  }
  return problems;
}

function check(directory) {
  const problems = [];
  const names = readdirSync(directory).filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));
  for (const file of names) {
    const name = path.basename(file).replace(/\.ya?ml$/, '');
    problems.push(...problemsFor(name, readFileSync(path.join(directory, file), 'utf8')));
  }
  return problems;
}

function main(argv) {
  const flags = argv.filter(arg => arg.startsWith('--'));
  const [directory = '.github/workflows'] = argv.filter(arg => !arg.startsWith('--'));
  if (flags.includes('--list-exceptions')) {
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
