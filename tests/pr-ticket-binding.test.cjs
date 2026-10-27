const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');

const workflow = yaml.load(readFileSync('.github/workflows/pr-guards-trusted.yml', 'utf8'));
const step = workflow.jobs['pr-guards-trusted'].steps.find(step => step.id === 'title');
const checkTitle = require('../.github/scripts/pr-title.cjs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const repo = 'hypertask-ai/hypertask';

async function run({ title = 'YPER4-731 [INFRA] Bind tickets', head = repo, base = repo,
  login = 'runner', dispatch = false, prNumber = 123, state = 'open', token = 'fixture-token', status = 200, result, fetchError } = {}) {
  const writes = [];
  const failures = [];
  const outputs = {};
  const ticket = title.split(' ')[0];
  const url = `https://github.com/${repo}/pull/123`;
  const previous = process.env.HYPERTASK_MCP_TOKEN;
  const previousMetadata = process.env.PR_METADATA;
  process.env.HYPERTASK_MCP_TOKEN = token;
  try {
    const args = {
      github: { rest: { pulls: { get: async () => ({ data: {
        number: 123, title, state, user: { login },
        head: { sha: 'a'.repeat(40), repo: { full_name: head } },
        base: { ref: 'production', repo: { full_name: base } },
      } }) } } },
      context: { repo: { owner: 'hypertask-ai', repo: 'hypertask' }, payload: dispatch ? { inputs: { pr_number: String(prNumber) } } : { pull_request: { number: prNumber, title: 'stale payload' } } },
      core: { info() {}, setOutput: (key, value) => { outputs[key] = value; }, setFailed: message => failures.push(message) },
      fetchImpl: async (endpoint, options) => {
        writes.push({ endpoint, options });
        if (fetchError) throw fetchError;
        return { ok: status === 200, status, json: async () => result ?? {
          success: true, tasks: [{ ticketNumber: ticket, pullRequests: [{ url }] }],
        } };
      },
    };
    process.env.PR_METADATA = JSON.stringify((await args.github.rest.pulls.get()).data);
    const entry = dispatch ? workflow.jobs['bind-ticket'].steps[1] : step;
    await new AsyncFunction('github', 'context', 'core', 'require', entry.with.script)(
      args.github, args.context, args.core,
      specifier => {
        assert.equal(specifier, './.github/scripts/pr-title.cjs');
        return inputs => checkTitle({ ...inputs, fetchImpl: args.fetchImpl });
      },
    );
    return { writes, failures, outputs };
  } finally {
    if (previousMetadata === undefined) delete process.env.PR_METADATA;
    else process.env.PR_METADATA = previousMetadata;
    if (previous === undefined) delete process.env.HYPERTASK_MCP_TOKEN;
    else process.env.HYPERTASK_MCP_TOKEN = previous;
  }
}

test('trusted title guard binds each supported ticket without runner files', async () => {
  assert.equal(step.env?.HYPERTASK_MCP_TOKEN, '${{ secrets.HYPERTASK_MCP_TOKEN }}');
  for (const prefix of ['HTPR', 'HYFA', 'YPER4']) {
    const result = await run({ title: `${prefix}-731 [INFRA] Bind tickets` });
    assert.deepEqual(result.failures, []);
    assert.equal(result.writes.length, 1);
    const { endpoint, options } = result.writes[0];
    assert.equal(endpoint, 'https://app.hypertask.ai/api/mcp/tasks/update');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    assert.deepEqual(JSON.parse(options.body), {
      ticket_number: `${prefix}-731`, pull_request_url: 'https://github.com/hypertask-ai/hypertask/pull/123',
    });
    assert.equal(result.outputs.title, `${prefix}-731 [INFRA] Bind tickets`);
  }
});

test('outside and wrong-base PRs never receive board credentials', async () => {
  for (const options of [{ head: 'outside/hypertask' }, { base: 'outside/hypertask' }]) {
    assert.deepEqual((await run(options)).writes, []);
  }
  const invalid = await run({ title: 'No ticket' });
  assert.deepEqual(invalid.writes, []);
  assert.equal(invalid.failures.length, 1);
});

test('missing credentials and rejected or unproven bindings cannot pass', async () => {
  await assert.rejects(run({ token: '' }), /HYPERTASK_MCP_TOKEN/);
  await assert.rejects(run({ status: 403 }), /HTTP 403/);
  await assert.rejects(run({ fetchError: new Error('network failed') }), /network failed/);
  for (const result of [
    { success: false }, { success: true, tasks: [] },
    { success: true, tasks: [{ ticketNumber: 'YPER4-999', pullRequests: [{ url: `https://github.com/${repo}/pull/123` }] }] },
    { success: true, tasks: [{ ticketNumber: 'YPER4-731', pullRequests: [] }] },
  ]) await assert.rejects(run({ result }), /binding was not confirmed/);
});

test('a delayed CI run still binds its merged PR', async () => {
  const result = await run({ state: 'closed' });
  assert.deepEqual(result.failures, []);
  assert.equal(result.writes.length, 1);
  assert.deepEqual(JSON.parse(result.writes[0].options.body), {
    ticket_number: 'YPER4-731', pull_request_url: 'https://github.com/hypertask-ai/hypertask/pull/123',
  });
});

test('ticketed runner bots bind while unticketed dependency bots stay exempt', async () => {
  const runner = await run({ login: 'hypertask-runners[bot]' });
  assert.equal(runner.writes.length, 1);
  assert.deepEqual(JSON.parse(runner.writes[0].options.body), {
    ticket_number: 'YPER4-731', pull_request_url: 'https://github.com/hypertask-ai/hypertask/pull/123',
  });
  const dependency = await run({ login: 'dependabot[bot]', title: 'Bump a dependency' });
  assert.deepEqual(dependency.writes, []);
  assert.deepEqual(dependency.failures, []);
});

test('production manual CI uses the same binding entry and refuses malformed PR numbers', async () => {
  const job = workflow.jobs['bind-ticket'];
  assert.equal(job.if, "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/production'");
  const admitted = new Function('github', `return (${job.if});`);
  assert.equal(admitted({ event_name: 'workflow_dispatch', ref: 'refs/heads/production' }), true);
  assert.equal(admitted({ event_name: 'workflow_dispatch', ref: 'refs/heads/untrusted' }), false);
  assert.equal(admitted({ event_name: 'pull_request', ref: 'refs/heads/production' }), false);
  assert.equal(job.steps[0].with.ref, 'production');
  assert.equal(job.steps[0].with['persist-credentials'], false);
  assert.match(job.steps[1].with.script, /pr-title\.cjs/);
  const manual = await run({ dispatch: true, login: 'hypertask-runners[bot]' });
  assert.deepEqual(JSON.parse(manual.writes[0].options.body), {
    ticket_number: 'YPER4-731', pull_request_url: 'https://github.com/hypertask-ai/hypertask/pull/123',
  });
  await assert.rejects(run({ dispatch: true, prNumber: 'invalid' }), /Invalid PR number/);
});
