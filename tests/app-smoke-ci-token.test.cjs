const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');

const workflow = yaml.load(readFileSync('.github/workflows/app-smoke.yml', 'utf8'));
const script = workflow.jobs.validate.steps.find((step) => step.id === 'current-request').with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('github', 'context', 'core', 'process', script);

async function scenario({ failApp = false, supersede = false } = {}) {
  const calls = [];
  const outputs = [];
  const warnings = [];
  let headReads = 0;
  class Client {
    constructor({ auth }) {
      this.auth = auth;
      calls.push(['client', auth]);
      this.rest = {
        pulls: { get: async () => {
          calls.push(['head', this.auth]);
          if (this.auth === 'app-token' && failApp) {
            failApp = false;
            throw Object.assign(new Error('bad token'), { status: 401 });
          }
          headReads++;
          return { data: { state: 'open', head: { sha: supersede && headReads > 1 ? 'new-head' : 'current-head' } } };
        } },
        actions: {
          listWorkflowRuns: () => {},
          cancelWorkflowRun: async ({ run_id }) => { calls.push(['cancel', this.auth, run_id]); },
        },
      };
    }
    async paginate(_method, { status }) {
      calls.push(['list', this.auth, status]);
      return status === 'queued' ? [{ id: 7, status: 'queued', run_number: 3, display_title: 'App Smoke request 9 for owner/repo:branch' }] : [];
    }
  }
  const github = new Client({ auth: 'app-token' });
  const context = {
    repo: { owner: 'owner', repo: 'repo' }, runId: 42, runNumber: 4,
    payload: { workflow_run: { run_number: 10, head_repository: { full_name: 'owner/repo' }, head_branch: 'branch' } },
  };
  const core = { setOutput: (key, value) => outputs.push([key, value]), info: () => {}, warning: (message) => warnings.push(message) };
  const process = { env: { GITHUB_WORKSPACE: processCwd, PR: '123', HEAD_SHA: 'current-head', GH_FALLBACK_TOKEN: 'actions-token', CI_TOKEN_MINTED: 'true' } };
  await run(github, context, core, process);
  return { calls, outputs, warnings };
}

const processCwd = process.cwd();

test('failed App authentication retries discovery using github.token', async () => {
  const { calls, outputs, warnings } = await scenario({ failApp: true });
  assert.deepEqual(calls.slice(0, 4), [['client', 'app-token'], ['head', 'app-token'], ['client', 'actions-token'], ['head', 'actions-token']]);
  assert.deepEqual(calls.filter(([kind]) => kind === 'cancel'), [['cancel', 'actions-token', 7]]);
  assert.equal(calls.filter(([kind, auth]) => kind === 'head' && auth === 'actions-token').length, 3);
  assert.equal(warnings.length, 1);
  assert.deepEqual(outputs, []);
});

test('fallback rechecks the head before cancelling older requests', async () => {
  const { calls, outputs } = await scenario({ failApp: true, supersede: true });
  assert.deepEqual(outputs, [['superseded', 'true']]);
  assert.deepEqual(calls.filter(([kind]) => kind === 'cancel'), []);
  assert.equal(calls.filter(([kind, auth]) => kind === 'head' && auth === 'actions-token').length, 2);
});

test('successful App requests never use the fallback token', async () => {
  const { calls, outputs, warnings } = await scenario();
  assert.deepEqual(calls.filter(([kind]) => kind === 'client'), [['client', 'app-token']]);
  assert.deepEqual(calls.filter(([kind]) => kind === 'cancel'), [['cancel', 'app-token', 7]]);
  assert.equal(calls.filter(([kind]) => kind === 'head').length, 3);
  assert.deepEqual(outputs, []);
  assert.deepEqual(warnings, []);
});
