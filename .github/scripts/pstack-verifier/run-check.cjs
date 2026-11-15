'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { commandAllowed, publicNote } = require('./verdict.cjs');

function runCommands(commands, cwd) {
  const chunks = [];
  for (const argv of commands) {
    if (!commandAllowed(argv)) return { exitCode: 1, output: 'refused a command that is not the changed test or script check' };
    const child = spawnSync(process.execPath, argv, { cwd, encoding: 'utf8', timeout: 8 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    chunks.push(child.stdout || '', child.stderr || '');
    if (child.error) return { exitCode: child.status ?? 1, output: publicNote(chunks.join('\n') || child.error.message) };
    if (child.status !== 0) return { exitCode: child.status ?? 1, output: publicNote(chunks.join('\n')) };
  }
  return { exitCode: 0, output: publicNote(chunks.join('\n')) };
}

function main() {
  const planPath = process.env.PSTACK_PLAN;
  const resultPath = process.env.PSTACK_CHECK_RESULT;
  const head = process.env.PSTACK_HEAD;
  if (!planPath || !resultPath || !head) {
    console.error('pstack-verifier: PSTACK_PLAN, PSTACK_CHECK_RESULT and PSTACK_HEAD are required');
    process.exit(64);
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const cwd = path.resolve(head);
  const result = fs.existsSync(cwd)
    ? runCommands(plan.commands ?? [], cwd)
    : { exitCode: 1, output: 'the head checkout is missing' };
  fs.writeFileSync(resultPath, JSON.stringify(result), { mode: 0o600 });
  console.log(`pstack-verifier check: exit ${result.exitCode}`);
  process.exitCode = 0;
}

module.exports = { runCommands };

if (require.main === module) main();
