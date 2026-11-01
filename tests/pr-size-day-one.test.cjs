const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');
const sweep = require('../.github/scripts/pr-size-day-one.cjs');
const policy = require('../.github/scripts/pr-size-policy.json');

const BEFORE = Date.parse(policy.blockFrom) - 1000;
const AFTER = Date.parse(policy.blockFrom) + 1000;
const GUARD = policy.dayOne.guardWorkflow;

const file = (filename, additions, deletions = 0) => ({ filename, additions, deletions });
const pull = (number, user, extra = {}) => ({
  number, state: 'open', base: { ref: 'production' }, labels: [],
  user, head: { sha: `sha${number}`, repo: { full_name: 'hypertask-ai/hypertask' } },
  additions: 0, deletions: 0, changed_files: 0, ...extra,
});
const agentPull = (number, extra) => pull(number, { login: 'app/hypertask-runners', type: 'Bot' }, extra);

function fake({ pulls = [], files = {}, comments = {}, runs = [], guardRuns = [] } = {}) {
  const calls = { created: [], posts: [], reruns: [], runQueries: [] };
  const route = fn => fn.route;
  const github = {
    paginate: async (fn, params) => {
      if (route(fn) === 'listPulls') return pulls;
      if (route(fn) === 'listFiles') return files[params.pull_number] ?? [];
      if (route(fn) === 'listComments') {
        return typeof comments === 'function' ? comments(params) : comments[params.issue_number] ?? [];
      }
      throw new Error(`unexpected paginate ${route(fn)}`);
    },
    rest: {
      pulls: {
        list: Object.assign(async () => ({ data: pulls }), { route: 'listPulls' }),
        listFiles: Object.assign(async () => ({ data: [] }), { route: 'listFiles' }),
        get: async ({ pull_number }) => {
          const found = pulls.find(item => item.number === pull_number);
          if (!found) throw new Error(`no such pull ${pull_number}`);
          return { data: { ...found, head: { ...found.head } } };
        },
      },
      issues: {
        listComments: Object.assign(async () => ({ data: [] }), { route: 'listComments' }),
        createComment: async ({ body }) => { calls.created.push(body); return { data: {} }; },
        updateComment: async ({ body }) => { calls.created.push(body); return { data: {} }; },
      },
      actions: {
        listWorkflowRuns: async query => {
          calls.runQueries.push(query);
          return { data: { workflow_runs: query.head_sha ? guardRuns : runs } };
        },
        rerunWorkflowRun: async query => { calls.reruns.push(query); return { data: {} }; },
      },
      repos: {
        createCommitStatus: async () => {
          throw new Error('the sweep must never publish a commit status');
        },
      },
    },
  };
  return { github, calls };
}

function coreOf() {
  const lines = [];
  return {
    lines,
    info: message => lines.push(String(message)),
    warning: message => lines.push(String(message)),
    setOutput: () => {},
    setFailed: message => lines.push(String(message)),
    summary: { addRaw: () => ({ write: async () => {} }) },
  };
}

const context = {
  repo: { owner: 'hypertask-ai', repo: 'hypertask' },
  serverUrl: 'https://github.com',
  runId: '42',
  runAttempt: 1,
  eventName: 'schedule',
  payload: {},
};

async function run(options, { now = AFTER, eventName = 'schedule' } = {}) {
  const posts = [];
  const requests = [];
  const savedFetch = globalThis.fetch;
  const savedToken = process.env.HYPERTASK_MCP_TOKEN;
  process.env.HYPERTASK_MCP_TOKEN = savedToken ?? 'test-only-board-token';
  globalThis.fetch = async (url, init) => {
    const request = { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
    if (String(url).startsWith('https://api.github.com/')) {
      requests.push(request);
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    }
    posts.push({ url, body: request.body, key: init.headers['Idempotency-Key'] });
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  const harness = fake(options);
  const core = coreOf();
  try {
    const result = await sweep({ github: harness.github, context: { ...context, eventName }, core, now });
    return { result, posts, calls: harness.calls, requests, lines: core.lines };
  } catch (error) {
    error.log = core.lines;
    error.posts = posts;
    throw error;
  } finally {
    globalThis.fetch = savedFetch;
    if (savedToken === undefined) delete process.env.HYPERTASK_MCP_TOKEN;
    else process.env.HYPERTASK_MCP_TOKEN = savedToken;
  }
}

const guardRun = (id, number, sha, extra = {}) => ({
  id, head_sha: sha, created_at: `2026-10-30T0${id}:00:00Z`, conclusion: 'success',
  pull_requests: [{ number }], ...extra,
});

test('a scheduled run before blocking starts sweeps nothing', async () => {
  const { result, posts, requests } = await run({ pulls: [agentPull(1)] }, { now: BEFORE });
  assert.equal(result.waiting, true);
  assert.equal(result.swept, false);
  assert.equal(posts.length, 0);
  assert.deepEqual(requests, []);
});

test('an over-cap agent change goes back to the guard and the rest are left alone', async () => {
  const big = agentPull(1, { additions: 500, changed_files: 1 });
  const small = agentPull(2, { additions: 200, changed_files: 1 });
  const human = pull(3, { login: 'valentinyeo', type: 'User' }, { additions: 900, changed_files: 1 });
  const dependabot = pull(4, { login: 'dependabot[bot]', type: 'Bot' }, { additions: 700, changed_files: 1 });
  const guardRuns = [guardRun(3, 1, 'sha1'), guardRun(5, 1, 'sha1')];
  const { posts, requests, calls } = await run({
    pulls: [big, small, human, dependabot],
    files: { 1: [file('src/a.ts', 500)], 2: [file('src/b.ts', 200)] },
    guardRuns,
  });
  assert.deepEqual(requests, [], 'no GitHub REST call by hand; only the client may write');
  assert.deepEqual(calls.reruns, [{ owner: 'hypertask-ai', repo: 'hypertask', run_id: 5 }], 'the newest guard run at this head is re-run');
  const guardQueries = calls.runQueries.filter(query => query.head_sha);
  assert.deepEqual(guardQueries.map(query => [query.workflow_id, query.head_sha, query.status]), [
    [GUARD, 'sha1', 'completed'],
  ]);
  assert.deepEqual(posts.map(post => post.body.ticket_number), ['HYCI-51']);
  assert.match(posts[0].body.text, /Open agent changes: 2\./);
  assert.match(posts[0].body.text, /sent to fail: 1\. <a href="https:\/\/github.com\/hypertask-ai\/hypertask\/pull\/1">#1<\/a>/);
  assert.match(posts[0].body.text, /Under the cap, still passing: 1\./);
  assert.doesNotMatch(posts[0].body.text, /pr-title/);
});

test('a big change is left alone only with the size-ok label and a human reason', async () => {
  const big = agentPull(1, { additions: 500, changed_files: 1, labels: [{ name: 'size-ok' }] });
  const files = { 1: [file('src/a.ts', 500)] };
  const reason = [{ user: { login: 'valentinyeo', type: 'User' }, body: 'size-ok: read it by hand' }];
  const allowed = await run({ pulls: [big], files, comments: { 1: reason }, guardRuns: [guardRun(3, 1, 'sha1')] });
  assert.deepEqual(allowed.result.counts.allowed, [1]);
  assert.deepEqual(allowed.calls.reruns, [], 'an allowed change needs no guard run');
  const alone = await run({ pulls: [big], files, guardRuns: [guardRun(3, 1, 'sha1')] });
  assert.deepEqual(alone.calls.reruns.map(query => query.run_id), [3]);
});

test('a guard run at another head, another change or a skip is never re-run', async () => {
  const { result, calls } = await run({
    pulls: [agentPull(1, { additions: 500, changed_files: 1 })],
    files: { 1: [file('src/a.ts', 500)] },
    guardRuns: [
      guardRun(1, 1, 'sha1', { conclusion: 'skipped' }),
      guardRun(2, 1, 'sha9'),
      guardRun(4, 2, 'sha1'),
      guardRun(6, 1, 'sha1', { conclusion: 'failure' }),
    ],
  });
  assert.deepEqual(result.counts.sent, [1]);
  assert.deepEqual(calls.reruns.map(query => query.run_id), [6]);
});

test('a change with no guard run at its head still posts the counts and then fails loudly', async () => {
  const error = await run(
    { pulls: [agentPull(1, { additions: 500, changed_files: 1 })], files: { 1: [file('src/a.ts', 500)] } },
  ).then(() => null, failure => failure);
  assert.match(error.message, /1 over-cap change\(s\) were not sent to the guards/);
  assert.match(error.log.join('\n'), /was not sent to the guards: no completed pr-guards-trusted\.yml run at sha1/);
  assert.equal(error.posts.length, 1, 'the counts reach the ticket even when the sweep is incomplete');
  assert.equal(error.posts[0].body.ticket_number, 'HYCI-51');
  assert.match(error.posts[0].body.text, /sent to fail: 0\./);
  assert.match(error.posts[0].body.text, /Could not check or ask: 1\. <a href="https:\/\/github.com\/hypertask-ai\/hypertask\/pull\/1">#1<\/a>/);
});

test('a change that cannot be measured is named, never counted as passing', async () => {
  const { posts } = await run({
    pulls: [agentPull(7, { changed_files: 2 }), agentPull(8, { additions: 200, changed_files: 1 })],
    files: { 8: [file('src/b.ts', 200)] },
  });
  assert.match(posts[0].body.text, /Could not check or ask: 1\. <a href="https:\/\/github.com\/hypertask-ai\/hypertask\/pull\/7">#7<\/a>/);
});

test('only a successful scheduled run counts as the first sweep', async () => {
  const { result, calls, requests } = await run({ pulls: [agentPull(1)], runs: [{ id: '7' }] });
  assert.equal(result.alreadySwept, true);
  assert.deepEqual(requests, []);
  assert.deepEqual(calls.runQueries.map(query => query.event), ['schedule']);
});

test('a dispatch before blocking starts reports what would fail and asks nothing', async () => {
  const { result, posts, requests } = await run(
    { pulls: [agentPull(1, { additions: 500, changed_files: 1 })], files: { 1: [file('src/a.ts', 500)] } },
    { now: BEFORE, eventName: 'workflow_dispatch' },
  );
  assert.equal(result.swept, true);
  assert.deepEqual(result.counts.sent, [1]);
  assert.deepEqual(requests, []);
  assert.match(posts[0].body.text, /would fail: 1\./);
  assert.match(posts[0].key, /rehearsal/);
});

test('the ticket text carries the counts, the links and the day', () => {
  const text = sweep.ticketText(context, { agentChanges: 8, sent: [1, 2, 3], allowed: [4], withinCap: 4, unavailable: [] }, true);
  assert.match(text, /Day one: big agent changes go back to the size check\./);
  assert.match(text, /Open agent changes: 8\./);
  assert.match(text, /Allowed by size-ok and a human reason: 1\./);
  assert.match(sweep.ticketText(context, { agentChanges: 0, sent: [], allowed: [], withinCap: 0, unavailable: [] }, false), /would fail: 0/);
});

test('the workflow keeps no way to publish a verdict and triggers on a schedule only', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/pr-size-day-one.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(workflow.permissions.statuses, undefined, 'the sweep must not be allowed to write a status');
  assert.equal(workflow.jobs.sweep['runs-on'], 'ubuntu-latest');
  assert.equal(workflow.jobs.sweep.if, "github.ref == 'refs/heads/production'");
  const checkout = workflow.jobs.sweep.steps.find(step => String(step.uses).startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, 'production');
  assert.equal(workflow.permissions.actions, 'write', 're-running the guard is the only trigger');
  const mints = workflow.jobs.sweep.steps.filter(step => String(step.uses).startsWith('actions/create-github-app-token'));
  assert.deepEqual(mints, [], 'the Issues-write app token is what the CI App does not grant (HYCI-51)');
  const measure = workflow.jobs.sweep.steps.find(step => step.name === 'Measure every open agent change once');
  assert.deepEqual(Object.keys(measure.env), ['HYPERTASK_MCP_TOKEN']);
});
