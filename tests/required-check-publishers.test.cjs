const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');
const main = require('../.github/scripts/required-check-publishers.cjs');
const { QUIET_HOURS, TICKET, SAMPLE } = main;
const NOW = Date.parse('2026-11-22T15:00:00.000Z');
const sha = (number) => `${number}`.padStart(40, 'a');
const pull = (number, hours, extra = {}) => ({
  number, draft: false, updated_at: new Date(NOW - hours * 3600_000).toISOString(),
  base: { ref: 'production' }, head: { sha: sha(number) }, ...extra,
});
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const failed = (status) => ({ ok: false, status, json: async () => ({ error: 'refused' }) });
const saved = ok({ success: true, routedTo: 'comments', visibleToPeople: true });
const pageOf = (value, id, page) => (typeof value === 'function' ? value(id, page) : (value?.[id] ?? []));
function client({ contexts = ['pstack-verifier'], pulls = [], statuses, runs, comment = saved, rulesetStatus = 200 } = {}) {
  const calls = { github: [], posts: [] };
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    if (url.startsWith('https://app.hypertask.ai/')) {
      calls.posts.push({ auth: init.headers.Authorization, key: init.headers['Idempotency-Key'], body: JSON.parse(init.body) });
      return comment;
    }
    const parsed = new URL(url);
    const page = parsed.searchParams.get('page');
    calls.github.push({ method, path: parsed.pathname, page, auth: init.headers.Authorization });
    if (parsed.pathname.endsWith('/rulesets')) return rulesetStatus === 200
      ? ok(page === '1' ? [{ id: 7, name: 'production-required-checks', enforcement: 'active' }] : []) : failed(rulesetStatus);
    if (parsed.pathname.endsWith('/rulesets/7')) return ok({ rules: [{ type: 'required_status_checks', parameters: { required_status_checks: contexts.map((item) => {
      const context = typeof item === 'string' ? item : item.context;
      return { context, integration_id: typeof item === 'string' ? (context === 'pstack-verifier' ? 5264284 : 15368) : item.integration_id };
    }) } }] });
    if (parsed.pathname.endsWith('/pulls')) return ok(typeof pulls === 'function' ? pulls(page) : (page === '1' ? pulls : []));
    const status = /\/commits\/([0-9a-f]{40})\/statuses$/.exec(parsed.pathname);
    if (status) return statuses === 'fail' ? failed(500) : ok((typeof statuses === 'function' || page === '1' ? pageOf(statuses, status[1], page) : []).map((row) => row?.creator || !row?.context ? row : { ...row, creator: { login: row.context === 'pstack-verifier' ? 'hypertask-runners[bot]' : 'github-actions[bot]' } }));
    const run = /\/commits\/([0-9a-f]{40})\/check-runs$/.exec(parsed.pathname);
    if (run) return runs === 'fail' ? failed(500) : ok({ check_runs: (typeof runs === 'function' || page === '1' ? pageOf(runs, run[1], page) : []).map((row) => row?.app || !row?.name ? row : { ...row, app: { id: row.name === 'pstack-verifier' ? 5264284 : 15368 } }) });
    return failed(404);
  };
  return { fetchImpl, calls };
}
const run = (fetchImpl, extra = {}) => main({
  fetchImpl, token: 'github-token', boardToken: 'board-token', repository: 'hypertask-ai/hypertask',
  now: NOW, runUrl: 'https://github.com/hypertask-ai/hypertask/actions/runs/99', ...extra,
});
const readsOnly = (calls) => calls.github.every((call) => call.method === 'GET' && call.auth === 'Bearer github-token');
const posted = (calls) => calls.posts[0];
test('a required check with no result is posted once for people and GitHub is only read', async () => {
  const { fetchImpl, calls } = client({ pulls: [pull(4, 4)] });
  assert.deepEqual(await run(fetchImpl), { posted: true, silent: ['pstack-verifier'] });
  assert.deepEqual([calls.posts.length, posted(calls).auth, posted(calls).body.ticket_number, posted(calls).body.kind, posted(calls).key], [1, 'Bearer board-token', TICKET, 'qa', ['required-check-publishers', TICKET, '2026-11-22', 'pstack-verifier'].join('-')]);
  assert.match(posted(calls).body.text, /The required check pstack-verifier has no result from the ruleset app[\s\S]*does not change the ruleset/);
  const again = await run(fetchImpl, { now: NOW + 3600_000 });
  assert.deepEqual([again.posted, calls.posts[1].key, calls.posts[1].body], [true, posted(calls).key, posted(calls).body]);
  assert.equal(readsOnly(calls), true);
});
test('a pending status, a failure, a skipped check run, and a later page all count as a publisher', async () => {
  const cases = [
    client({ pulls: [pull(1, 5)], statuses: { [sha(1)]: [{ context: 'pstack-verifier', state: 'pending' }] } }),
    client({ pulls: [pull(2, 5)], statuses: { [sha(2)]: [{ context: 'pstack-verifier', state: 'failure' }] } }),
    client({ pulls: [pull(3, 5)], runs: { [sha(3)]: [{ name: 'pstack-verifier', conclusion: 'skipped' }] } }),
    client({
      pulls: [pull(5, 4)],
      runs: (_id, page) => (page === '1' ? Array.from({ length: 100 }, (_item, index) => ({ name: `other-${index}` })) : [{ name: 'pstack-verifier' }]),
    }),
  ];
  for (const { fetchImpl, calls } of cases) {
    assert.deepEqual(await run(fetchImpl, { boardToken: '' }), { posted: false, reason: 'healthy' });
    assert.deepEqual([calls.posts, readsOnly(calls)], [[], true]);
  }
  assert.ok(cases[3].calls.github.some((call) => call.path.endsWith('/check-runs') && call.page === '2'));
});
test('one published check stays quiet while the unpublished one is named', async () => {
  const mixed = client({
    contexts: ['pstack-verifier', 'premerge-evidence'], pulls: [pull(1, 4), pull(2, 6)],
    statuses: { [sha(2)]: [{ context: 'pstack-verifier', state: 'success' }] },
  });
  assert.deepEqual((await run(mixed.fetchImpl)).silent, ['premerge-evidence']);
  assert.match(posted(mixed.calls).body.text, /premerge-evidence has no result/);
  assert.doesNotMatch(posted(mixed.calls).body.text, /pstack-verifier/);
  const both = client({ contexts: ['premerge-evidence', 'pstack-verifier'], pulls: [pull(3, 4)] });
  assert.deepEqual((await run(both.fetchImpl)).silent, ['premerge-evidence', 'pstack-verifier']);
  assert.match(posted(both.calls).body.text, /premerge-evidence and pstack-verifier have no result/);
});
test('young pull requests, drafts, and an empty list report nothing', async () => {
  const young = pull(1, 0, { updated_at: new Date(NOW - QUIET_HOURS * 3600_000 + 1).toISOString() });
  for (const pulls of [[], [young], [pull(2, 8, { draft: true })]]) {
    const { fetchImpl, calls } = client({ pulls });
    assert.deepEqual(await run(fetchImpl, { boardToken: '' }), { posted: false, reason: 'too-soon' });
    assert.deepEqual([calls.posts, calls.github.some((call) => call.path.includes('/commits/'))], [[], false]);
  }
  assert.equal((await run(client({ pulls: [pull(3, QUIET_HOURS)] }).fetchImpl)).posted, true);
});
test('an aged pull request on the next page is still compared', async () => {
  const { fetchImpl, calls } = client({
    pulls: (page) => (page === '1' ? Array.from({ length: 100 }, (_item, index) => pull(index + 30, 1)) : [pull(4, 5)]),
  });
  assert.deepEqual([(await run(fetchImpl)).posted, calls.github.some((call) => call.path.includes(`/commits/${sha(4)}/`))], [true, true]);
});
test('the newest sample decides and a later pull request is not read', async () => {
  const rows = Array.from({ length: SAMPLE + 1 }, (_item, index) => pull(index + 1, 4 + index));
  const { fetchImpl, calls } = client({
    pulls: rows, statuses: { [sha(SAMPLE + 1)]: [{ context: 'pstack-verifier', state: 'success' }] },
  });
  assert.deepEqual([(await run(fetchImpl)).posted, calls.github.filter((call) => call.path.endsWith('/statuses')).length], [true, SAMPLE]);
});
test('another app using the same check name does not hide a silent ruleset publisher', async () => {
  const foreign = client({ pulls: [pull(1, 4)], statuses: { [sha(1)]: [{ context: 'pstack-verifier', state: 'success', creator: { login: 'github-actions[bot]' } }] }, runs: { [sha(1)]: [{ name: 'pstack-verifier', conclusion: 'success', app: { id: 15368 } }] } });
  assert.deepEqual((await run(foreign.fetchImpl)).silent, ['pstack-verifier']);
  const status = client({ pulls: [pull(2, 4)], statuses: { [sha(2)]: [{ context: 'pstack-verifier', state: 'pending', creator: { login: 'hypertask-runners[bot]' } }] } });
  const actions = client({ contexts: [{ context: 'ci-tests', integration_id: 15368 }], pulls: [pull(3, 4)], runs: { [sha(3)]: [{ name: 'ci-tests', conclusion: 'failure', app: { id: 15368 } }] } });
  assert.deepEqual([await run(status.fetchImpl, { boardToken: '' }), await run(actions.fetchImpl, { boardToken: '' })], [{ posted: false, reason: 'healthy' }, { posted: false, reason: 'healthy' }]);
  const bare = client({ contexts: [{ context: 'pstack-verifier', integration_id: null }], pulls: [pull(4, 4)] });
  await assert.rejects(run(bare.fetchImpl), /no integration/);
  assert.equal(bare.calls.github.some((call) => call.path.endsWith('/pulls')), false);
});
test('a check name is escaped and a missing or refused writer does not claim success', async () => {
  const injected = client({ contexts: ['<SCRIPT>'], pulls: [pull(4, 4)] });
  await run(injected.fetchImpl);
  const text = posted(injected.calls).body.text;
  assert.equal(text.includes('&lt;SCRIPT&gt;') && !text.toLowerCase().includes('<script>'), true);
  const missing = client({ pulls: [pull(4, 4)] });
  await assert.rejects(run(missing.fetchImpl, { boardToken: '' }), /HYPERTASK_MCP_TOKEN is missing/);
  assert.deepEqual(missing.calls.posts, []);
  const refused = client({ pulls: [pull(4, 4)], comment: failed(401) });
  await assert.rejects(run(refused.fetchImpl), /HTTP 401/);
  assert.deepEqual([refused.calls.posts.length, refused.calls.posts[0].auth], [1, 'Bearer board-token']);
  const hidden = client({ pulls: [pull(4, 4)], comment: ok({ success: true, routedTo: 'log', visibleToPeople: false }) });
  await assert.rejects(run(hidden.fetchImpl), /hidden from people/);
  assert.equal(hidden.calls.posts.length, 1);
});
test('unreadable GitHub data and an empty ruleset post nothing', async () => {
  const ruleset = client({ rulesetStatus: 403 });
  await assert.rejects(run(ruleset.fetchImpl), /HTTP 403/);
  assert.deepEqual([ruleset.calls.posts, ruleset.calls.github.some((call) => call.path.endsWith('/pulls'))], [[], false]);
  const checks = client({ pulls: [pull(4, 4)], statuses: 'fail' });
  await assert.rejects(run(checks.fetchImpl), /HTTP 500/);
  const head = client({ pulls: [pull(4, 4, { head: { sha: 'short' } })] });
  await assert.rejects(run(head.fetchImpl), /head could not be read/);
  assert.deepEqual(checks.calls.posts.concat(head.calls.posts), []);
  const empty = client({ contexts: [] });
  assert.deepEqual(await run(empty.fetchImpl, { boardToken: '' }), { posted: false, reason: 'none-required' });
  assert.equal(empty.calls.github.some((call) => call.path.endsWith('/pulls')), false);
  const bare = client();
  await assert.rejects(run(bare.fetchImpl, { token: '' }), /GITHUB_TOKEN is missing/);
  assert.deepEqual(bare.calls.github, []);
});
test('the hourly job reads production with the board token and does not write the ruleset', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/required-check-publishers.yml', 'utf8'));
  const report = workflow.jobs.report;
  const chain = workflow.jobs.chain;
  const policy = yaml.load(readFileSync('docs/ci-policy.yml', 'utf8')).required_check_publishers;
  const step = report.steps.find((item) => item.run);
  const checkout = report.steps.find((item) => item.uses?.startsWith('actions/checkout@'));
  assert.deepEqual([workflow.on.schedule[0].cron, report['runs-on'], report['timeout-minutes'], checkout.with.ref, checkout.with['persist-credentials'], chain['timeout-minutes'], chain.if],
    ['41 * * * *', 'ubuntu-latest', 10, 'production', false, 75, '${{ !cancelled() }}']);
  assert.deepEqual([report.permissions, step.env.HYPERTASK_MCP_TOKEN, step.env.GITHUB_TOKEN, chain.permissions.actions, chain.permissions.contents], [{ contents: 'read', 'pull-requests': 'read', checks: 'read', statuses: 'read' }, '${{ secrets.HYPERTASK_MCP_TOKEN }}', '${{ github.token }}', 'write', 'read']);
  assert.match(`${report.if}\n${step.run}\n${chain.steps.at(-1).run}`, /refs\/heads\/production[\s\S]*required-check-publishers\.cjs[\s\S]*schedule-chain\.cjs hand-off --workflow required-check-publishers\.yml --gap-minutes 60/);
  assert.deepEqual([policy.quiet_hours, policy.ruleset_writes, policy.removes_required_checks, policy.ticket],
    [QUIET_HOURS, false, false, 'https://app.hypertask.ai/detail/project-15/9357']);
});
