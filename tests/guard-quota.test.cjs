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
  number: 721, state: 'open', title: 'YPER4-721 [INFRA] Recover quota', additions: 1, deletions: 1, changed_files: 1,
  head: { sha, repo: { full_name: 'fixture/repo' } },
  base: { ref: 'production', repo: { full_name: 'fixture/repo' } }, user: { login: 'runner' },
};
const limited = (headers = { 'retry-after': '1' }) => Object.assign(
  new Error('API rate limit exceeded for installation'), { status: 403, response: { headers } });

async function run({ limitedRead = false, limitedPost = false, limitedMetadataRead = false, event = {}, current = {}, outcomes = {}, evaluated = {}, baseline = false, runId = 1, initialStatus = 'success', afterPending = async () => {} } = {}) {
  const { retryGithubRequest } = await gate;
  const calls = [];
  const waits = [];
  const posts = [];
  const failures = [];
  const results = {};
  const eventPr = { ...pr, ...event };
  const visibleWhileWaiting = [];
  let visibleStatus = initialStatus;
  let clock = 1000000;
  const retry = request => retryGithubRequest(request, {
    now: () => clock, sleep: async ms => { waits.push(ms); visibleWhileWaiting.push(visibleStatus); clock += ms; }, log() {},
  });
  const context = {
    repo: { owner: 'fixture', repo: 'repo' }, eventName: 'pull_request_target',
    actor: 'runner', payload: { pull_request: eventPr }, serverUrl: 'https://github.com', runId,
  };
  const github = {
    rest: {
      pulls: { listFiles() {}, get: async () => {
        calls.push('pulls.get');
        if (limitedRead) { limitedRead = false; throw limited(); }
        if (limitedMetadataRead && posts.some(post => post.state === 'pending')) {
          limitedMetadataRead = false; throw limited();
        }
        return { data: { ...eventPr, ...(typeof current === 'function' ? current(calls) : current) } };
      } },
      repos: { createCommitStatus: async post => {
        calls.push('repos.createCommitStatus');
        if (limitedPost && (baseline || post.state !== 'pending')) { limitedPost = false; throw limited(); }
        posts.push(post);
        visibleStatus = post.state;
        if (post.state === 'pending') await afterPending();
      } },
      issues: { listComments() {} },
    },
    paginate: async method => {
      if (method === github.rest.pulls.listFiles) {
        calls.push('pulls.listFiles');
        return [{ filename: 'src/example.ts', additions: 1, deletions: 1 }];
      }
      calls.push('issues.listComments');
      return [];
    },
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
          if (specifier.endsWith('/ci-runner-policy.cjs')) return {
            checkPullRequest: async ({ pr: candidate }) => assert.deepEqual(candidate, results.metadata.outputs.pr ? JSON.parse(results.metadata.outputs.pr) : pr),
          };
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
    return { calls, waits, posts, failures, visibleWhileWaiting, visibleStatus };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('executed production workflow baseline spends 22 calls versus eight for the candidate', async () => {
  const old = process.env.HYPERTASK_MCP_TOKEN;
  process.env.HYPERTASK_MCP_TOKEN = 'isolated-fixture';
  try {
    const before = await run({ baseline: true });
    assert.equal(before.calls.length, 22);
    assert.equal(before.posts.length, 10);
    const after = await run();
    assert.equal(after.calls.length, 8);
    assert.equal(after.posts.length, 2);
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
      assert.deepEqual(normal.calls, ['pulls.get', 'repos.createCommitStatus', 'pulls.get', 'pulls.listFiles', 'pulls.get', 'issues.listComments', 'pulls.get', 'repos.createCommitStatus']);
      assert.deepEqual(normal.posts.map(({ context, state, sha: head }) => ({ context, state, head })), [
        { context: 'pr-title', state: 'pending', head: sha },
        { context: 'pr-title', state: 'success', head: sha },
      ]);
      const recovered = await run({ limitedRead: true, limitedPost: true });
      assert.deepEqual(recovered.failures, []);
      assert.deepEqual(recovered.waits, [1000, 1000]);
      assert.equal(recovered.calls.length, 11);
      assert.equal(recovered.posts.length, 2);
      assert.equal(recovered.posts.at(-1).state, 'success');
    }
  } finally {
    if (old === undefined) delete process.env.HYPERTASK_MCP_TOKEN; else process.env.HYPERTASK_MCP_TOKEN = old;
  }
});

test('combined guard cannot pass missing, failed or unevaluated outside/title/runner-policy results', async () => {
  const old = process.env.HYPERTASK_MCP_TOKEN;
  process.env.HYPERTASK_MCP_TOKEN = 'isolated-fixture';
  try {
    for (const id of ['outside', 'title', 'runner-policy']) {
      for (const outcome of ['failure', 'skipped', 'cancelled']) {
        const result = await run({ outcomes: { [id]: outcome } });
        assert.equal(result.posts.at(-1).state, 'failure');
        assert.equal(result.failures.length, 1);
      }
      const unevaluated = await run({ evaluated: { [id]: { sha: '' } } });
      assert.equal(unevaluated.posts.at(-1).state, 'failure');
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
        calls.filter(call => call === 'pulls.get').length >= 5 ? changed : {} });
      assert.deepEqual(result.waits, [1000]);
      assert.deepEqual(result.posts.map(post => post.state), ['pending']);
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

test('same-head invalid title clears an earlier success before quota-limited metadata reevaluation', async () => {
  const result = await run({ event: { title: 'Invalid title' }, limitedMetadataRead: true });
  assert.deepEqual(result.visibleWhileWaiting, ['pending']);
  assert.deepEqual(result.posts.map(({ context, state, sha: head }) => ({ context, state, head })), [
    { context: 'pr-title', state: 'pending', head: sha },
    { context: 'pr-title', state: 'failure', head: sha },
  ]);
});

test('stale title rechecks cannot invalidate a newer result', async () => {
  const old = process.env.HYPERTASK_MCP_TOKEN;
  process.env.HYPERTASK_MCP_TOKEN = 'isolated-fixture';
  try {
    for (const changed of [{ title: 'Newer title' }, { head: { ...pr.head, sha: 'b'.repeat(40) } },
      { base: { ...pr.base, ref: 'main' } }, { state: 'closed' }]) {
      const result = await run({ current: changed });
      assert.deepEqual(result.posts, []);
    }
    const current = await run({ event: { title: 'Invalid title' } });
    assert.deepEqual(current.posts.map(post => post.state), ['pending', 'failure']);
  } finally {
    if (old === undefined) delete process.env.HYPERTASK_MCP_TOKEN; else process.env.HYPERTASK_MCP_TOKEN = old;
  }
});


test('old-event rerun after current pending cannot cancel the current title verdict', async () => {
  const oldGroup = workflow.concurrency.group.replace('${{ github.run_id }}', '1');
  const currentGroup = workflow.concurrency.group.replace('${{ github.run_id }}', '2');
  assert.notEqual(oldGroup.toLowerCase(), currentGroup.toLowerCase());
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  let stale;
  const latest = await run({
    runId: 2, event: { title: 'Invalid current title' },
    afterPending: async () => {
      stale = await run({
        runId: 1, current: { title: 'Invalid current title' }, initialStatus: 'pending',
      });
    },
  });
  assert.deepEqual(stale.posts, []);
  assert.equal(stale.visibleStatus, 'pending');
  assert.deepEqual(latest.posts.map(post => post.state), ['pending', 'failure']);
  assert.equal(latest.visibleStatus, 'failure');
});
