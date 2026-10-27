const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const gate = import('../.github/scripts/github-rate-limit.mjs');
const workflow = yaml.load(readFileSync('.github/workflows/pr-guards-trusted.yml', 'utf8'));
const steps = workflow.jobs['pr-guards-trusted'].steps;
const sha = 'a'.repeat(40);
const pr = {
  number: 721, state: 'open', title: 'YPER4-721 [INFRA] Recover quota', additions: 1, deletions: 1,
  head: { sha, repo: { full_name: 'fixture/repo' } },
  base: { ref: 'production', repo: { full_name: 'fixture/repo' } }, user: { login: 'runner' },
};
const limited = (headers = { 'retry-after': '1' }) => Object.assign(
  new Error('API rate limit exceeded for installation'), { status: 403, response: { headers } });

async function run({ limitedRead = false, limitedPost = false, current = {}, outcomes = {}, evaluated = {}, baseline = false } = {}) {
  const { retryGithubRequest } = await gate;
  const calls = [];
  const waits = [];
  const posts = [];
  const failures = [];
  const results = {};
  let clock = 1000000;
  const retry = request => retryGithubRequest(request, {
    now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; }, log() {},
  });
  const context = {
    repo: { owner: 'fixture', repo: 'repo' }, eventName: 'pull_request_target',
    actor: 'runner', payload: { pull_request: pr }, serverUrl: 'https://github.com', runId: 1,
  };
  const github = {
    rest: {
      pulls: { get: async () => {
        calls.push('pulls.get');
        if (limitedRead) { limitedRead = false; throw limited(); }
        return { data: { ...pr, ...(typeof current === 'function' ? current(calls) : current) } };
      } },
      repos: { createCommitStatus: async post => {
        calls.push('repos.createCommitStatus');
        if (limitedPost) { limitedPost = false; throw limited(); }
        posts.push(post);
      } },
      issues: { listComments() {} },
    },
    paginate: async () => { calls.push('issues.listComments'); return []; },
  };
  const previous = { PR_METADATA: process.env.PR_METADATA, RESULTS: process.env.RESULTS };
  try {
    const groups = baseline ? JSON.parse(readFileSync('tests/fixtures/guard-quota-baseline.json', 'utf8')).groups : [steps];
    for (const group of groups) {
      for (const key of Object.keys(results)) delete results[key];
      for (const id of ['gitleaks', 'trufflehog', 'public-secrets']) results[id] = { outcome: 'success' };
      for (const step of group.filter(step => step.with?.script)) {
      const outputs = {};
      let failed = false;
      const core = {
        info() {}, warning() {},
        setOutput: (key, value) => { outputs[key] = value; },
        setFailed: message => { failures.push(message); failed = true; },
        summary: { addRaw() { return this; }, async write() {} },
      };
      process.env.PR_METADATA = results.metadata?.outputs.pr ?? '';
      process.env.RESULTS = JSON.stringify(results);
      const script = step.with.script.replace(/^.*const \{ retryGithubRequest \} = await import.*\n/m, '');
      await new AsyncFunction('github', 'context', 'core', 'require', 'retryGithubRequest', script)(
        github, context, core, specifier => {
          const impl = require(resolve(specifier));
          return args => impl({ ...args, fetchImpl: async () => ({
            ok: true, json: async () => ({ success: true, tasks: [{
              ticketNumber: 'YPER4-721', pullRequests: [{ url: 'https://github.com/fixture/repo/pull/721' }],
            }] }),
          }) });
        }, retry,
      );
      if (step.id) results[step.id] = {
        outcome: outcomes[step.id] ?? (failed ? 'failure' : 'success'),
        outputs: { ...outputs, ...evaluated[step.id] },
      };
    }
      }
    return { calls, waits, posts, failures };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('executed production workflow baseline spends 22 calls versus four for the candidate', async () => {
  const old = process.env.HYPERTASK_MCP_TOKEN;
  process.env.HYPERTASK_MCP_TOKEN = 'isolated-fixture';
  try {
    const before = await run({ baseline: true });
    assert.equal(before.calls.length, 22);
    assert.equal(before.posts.length, 10);
    const after = await run();
    assert.equal(after.calls.length, 4);
    assert.equal(after.posts.length, 1);
    assert.deepEqual(before.failures, []);
    assert.deepEqual(after.failures, []);
    await assert.rejects(run({ baseline: true, limitedRead: true }), /rate limit exceeded for installation/);
  } finally {
    if (old === undefined) delete process.env.HYPERTASK_MCP_TOKEN; else process.env.HYPERTASK_MCP_TOKEN = old;
  }
});

test('ten workflow push replays recover read and status quota refusals with fresh publication', async () => {
  const old = process.env.HYPERTASK_MCP_TOKEN;
  process.env.HYPERTASK_MCP_TOKEN = 'isolated-fixture';
  try {
    for (let push = 0; push < 10; push++) {
      const normal = await run();
      assert.deepEqual(normal.calls, ['pulls.get', 'issues.listComments', 'pulls.get', 'repos.createCommitStatus']);
      assert.deepEqual(normal.posts.map(({ context, state, sha: head }) => ({ context, state, head })), [
        { context: 'pr-title', state: 'success', head: sha },
      ]);
      const recovered = await run({ limitedRead: true, limitedPost: true });
      assert.deepEqual(recovered.failures, []);
      assert.deepEqual(recovered.waits, [1000, 1000]);
      assert.equal(recovered.calls.length, 7);
      assert.equal(recovered.posts.length, 1);
      assert.equal(recovered.posts[0].state, 'success');
    }
  } finally {
    if (old === undefined) delete process.env.HYPERTASK_MCP_TOKEN; else process.env.HYPERTASK_MCP_TOKEN = old;
  }
});

test('combined guard cannot pass missing, failed or unevaluated outside/title results', async () => {
  const old = process.env.HYPERTASK_MCP_TOKEN;
  process.env.HYPERTASK_MCP_TOKEN = 'isolated-fixture';
  try {
    for (const id of ['outside', 'title']) {
      for (const outcome of ['failure', 'skipped', 'cancelled']) {
        const result = await run({ outcomes: { [id]: outcome } });
        assert.equal(result.posts[0].state, 'failure');
        assert.equal(result.failures.length, 1);
      }
      const unevaluated = await run({ evaluated: { [id]: { sha: '' } } });
      assert.equal(unevaluated.posts[0].state, 'failure');
    }
  } finally {
    if (old === undefined) delete process.env.HYPERTASK_MCP_TOKEN; else process.env.HYPERTASK_MCP_TOKEN = old;
  }
});

test('a delayed status retry rechecks changed head, title, base and open state before posting', async () => {
  const old = process.env.HYPERTASK_MCP_TOKEN;
  process.env.HYPERTASK_MCP_TOKEN = 'isolated-fixture';
  try {
    for (const changed of [{ head: { ...pr.head, sha: 'b'.repeat(40) } }, { title: 'Edited title' },
      { base: { ...pr.base, ref: 'main' } }, { state: 'closed' }]) {
      const result = await run({ limitedPost: true, current: calls =>
        calls.filter(call => call === 'pulls.get').length >= 3 ? changed : {} });
      assert.deepEqual(result.waits, [1000]);
      assert.deepEqual(result.posts, []);
      assert.deepEqual(result.failures, []);
    }
  } finally {
    if (old === undefined) delete process.env.HYPERTASK_MCP_TOKEN; else process.env.HYPERTASK_MCP_TOKEN = old;
  }
});

test('retry refuses ordinary API failures and an over-budget reset without pretending success', async () => {
  const { retryGithubRequest, createRateLimitBudget } = await gate;
  for (const status of [403, 404, 500]) {
    let calls = 0;
    const error = Object.assign(new Error('Forbidden'), { status });
    await assert.rejects(retryGithubRequest(async () => { calls++; throw error; }, {
      sleep: () => assert.fail('ordinary failures must not sleep'),
    }), failure => failure === error);
    assert.equal(calls, 1);
  }
  const now = () => 1000000;
  await assert.rejects(retryGithubRequest(async () => { throw limited({ 'retry-after': '4000' }); }, {
    now, budget: createRateLimitBudget({ now, maxWaitMs: 3600000, timeBudgetMs: 3660000 }),
    sleep: () => assert.fail('over-budget retries must not sleep'),
  }), error => error.rateLimited === true);
  for (const step of steps.filter(step => /retryGithubRequest/.test(step.with?.script ?? ''))) {
    const url = pathToFileURL(resolve('.github/scripts/github-rate-limit.mjs')).href;
    assert.equal(typeof (await import(url)).retryGithubRequest, 'function');
  }
});
