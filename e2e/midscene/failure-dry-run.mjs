import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, copyFileSync } from 'node:fs';
import { processResults, ticketPlan } from './postprocess.mjs';

const startedAt = Date.now();
const run = spawnSync('./guarded-run.sh', ['--flow', 'signed-in-create-task', '--force-failure', 'signed-in-create-task'], { encoding: 'utf8', timeout: 120_000 });
assert.equal(run.status, 1, 'forced browser run must fail, not skip or crash');
const payload = JSON.parse(readFileSync('midscene_run/results-latest.json', 'utf8'));
assert(Date.parse(payload.startedAt) >= startedAt - 5_000, 'forced-failure results must be fresh');
assert.equal(payload.results.length, 1);
const failure = payload.results[0];
assert.equal(failure.flow, 'signed-in-create-task');
assert.equal(failure.error, 'Forced failure for reporter dry-run verification', 'QA cleanup must also pass');
assert.match(run.stdout, /QA cleanup passed/);
assert.match(failure.failedStep, /1\. goto/);
assert.equal(typeof failure.screenshotPath, 'string', `forced failure must capture a screenshot: ${run.stdout} ${run.stderr}`);
assert.equal(readFileSync(failure.screenshotPath).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
copyFileSync('midscene_run/results-latest.json', 'midscene_run/forced-failure-results.json');
const output = [];
const state = {};
const deps = {
  dryRun: true,
  listTickets: () => [],
  createTicket: () => { throw new Error('Dry-run attempted a board write'); },
  log: (line) => { output.push(line); console.log(line); },
};
processResults([failure], state, deps);
processResults([failure], state, deps);
assert.equal(output.filter((line) => line.startsWith('DRY RUN:')).length, 1);
assert.equal(output.filter((line) => line.startsWith('SUPPRESSED:')).length, 1);
// An actual open-ticket lookup also suppresses after a green night and lost local state.
const plan = ticketPlan(failure);
const existing = { title: plan.title, status: 'Normal', section: 'Bugs' };
processResults([{ ...failure, ok: true }, failure], {}, { ...deps, listTickets: () => [existing] });
assert.equal(output.filter((line) => line.startsWith('DRY RUN:')).length, 1);
console.log('Forced-failure dry-run passed: one would-create, repeated failure suppressed, no board writes.');
