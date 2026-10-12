const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const gate = import(pathToFileURL(path.join(root, '.github/scripts/ux-signoff-gate.mjs')));
const modified = { filename: 'src/components/x/Foo.tsx', status: 'modified' };
const added = { filename: 'src/components/notifications/DecisionInboxPanel.tsx', status: 'added' };
const title = 'HTPR-7072 [FEATURE] Decision inbox';
const wireframe = (overrides = {}) => ({
  id: 1, text: '<p><a href="https://hypertask.app/wireframes/decision-inbox">Wireframe</a></p>',
  createdAt: '2026-10-10T12:00:00Z', creatorId: 6, agent: { id: 'agent' }, reactions: [], ...overrides,
});
const yes = (overrides = {}) => ({
  id: 2, text: '<p>yes go</p>', createdAt: '2026-10-10T12:01:00Z', creatorId: 6, agent: null, reactions: [], ...overrides,
});
const input = (overrides = {}) => ({ title, author: 'builder', files: [modified], comments: [], ...overrides });
async function decision(overrides) {
  const result = (await gate).evaluate(input(overrides));
  assert.ok(result.description.length <= 140);
  return result;
}

test('PR 1271 shape fails both wireframe and new element rules', async () => {
  const result = await decision({ files: [{ filename: 'src/app/inbox/Inbox.tsx', status: 'modified' }, added] });
  assert.equal(result.state, 'failure');
  assert.equal(result.details.length, 2);
  assert.match(result.details[0], /yes on a wireframe on HTPR-7072/);
  assert.match(result.details[1], /DecisionInboxPanel.*yes by name/);
});

test('BUGFIX modifies existing UI without signoff but cannot add an unapproved element', async () => {
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair' })).state, 'success');
  const result = await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [{ ...added, filename: 'src/components/x/NewThing.tsx' }] });
  assert.equal(result.state, 'failure');
  assert.equal(result.details.length, 1);
  assert.match(result.description, /NewThing.*yes by name/);
});

test('only a Valentin approval reaction on the wireframe counts', async () => {
  for (const emoji of ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿', '✅', '👍️']) {
    assert.equal((await decision({ comments: [wireframe({ reactions: [{ userId: 6, emoji }] })] })).state, 'success');
  }
  for (const reaction of [{ userId: 7, emoji: '👍' }, { userId: '6', emoji: '✅' }, { userId: 6, emoji: '👎' }, { userId: 6, emoji: '👍', isAgent: true }, { userId: 6, emoji: '👍', agent: { displayName: 'Runner 4' } }]) {
    assert.equal((await decision({ comments: [wireframe({ reactions: [reaction] })] })).state, 'failure');
  }
  assert.equal((await decision({ comments: [wireframe(), yes({ text: 'Another comment', reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'failure');
});

test('only a later human Valentin yes approves a wireframe', async () => {
  assert.equal((await decision({ comments: [yes(), wireframe()] })).state, 'success');
  for (const approval of [
    yes({ createdAt: '2026-10-10T11:59:00Z' }), yes({ createdAt: '2026-10-10T12:00:00Z' }),
    yes({ createdAt: 'invalid' }), yes({ agent: { id: 'agent' } }), yes({ creatorId: 7 }), yes({ creatorId: '6' }),
  ]) assert.equal((await decision({ comments: [wireframe(), approval] })).state, 'failure');
});

test('all explicit approval prefixes work, but qualified or negative yes does not', async () => {
  for (const text of ['yes', 'yep', 'yeah', 'go', 'ok', 'okay', 'approve', 'approved', 'lgtm', 'looks good', 'ship it', '👍', 'YES go']) {
    assert.equal((await decision({ comments: [wireframe(), yes({ text })] })).state, 'success', text);
  }
  for (const text of ["yes but change the header", 'yes no', 'yes not now', "yes don't ship", 'yes don’t ship', 'yes instead', 'yes change it', 'yesterday', 'good', 'okayish', 'maybe yes']) {
    assert.equal((await decision({ comments: [wireframe(), yes({ text })] })).state, 'failure', text);
  }
});

test('mentions are removed and HTML and basic entities are decoded before matching', async () => {
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<span data-label="name-6" data-type="mention">Valentin Yeo</span><p>yes&nbsp;go</p>' })] })).state, 'success');
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<span data-type="mention">yes go</span><p>Maybe</p>' })] })).state, 'failure');
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<p>&#121;&#x65;s go</p>' })] })).state, 'success');
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<p>yes don&#39;t ship</p>' })] })).state, 'failure');
});

test('new elements need normalized names in approved wireframes or approving human comments', async () => {
  const approved = wireframe({ text: 'https://hypertask.app/explorations/decision_inbox New elements: Decision Inbox Panel', reactions: [{ userId: 6, emoji: '👍' }] });
  assert.equal((await decision({ files: [added], comments: [approved] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe({ reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'failure');
  assert.equal((await decision({ files: [added], comments: [wireframe(), yes({ text: 'yes Decision-Inbox_Panel' })] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: `${approved.text}<span data-type="mention">DecisionInboxPanel</span>`, reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: 'https://hypertask.app/wireframes/a <span data-type="mention">DecisionInboxPanel</span>', reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'failure');
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [added], comments: [yes({ text: 'approved DecisionInboxPanel' })] })).state, 'success');
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [added], comments: [yes({ text: 'approved DecisionInboxPanel', agent: { id: 'agent' } })] })).state, 'failure');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: approved.text }), yes({ text: 'maybe DecisionInboxPanel' })] })).state, 'failure');
});

test('copied components need names; renamed components, CSS and app files need only wireframes', async () => {
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [{ ...added, status: 'copied' }] })).state, 'failure');
  for (const file of [{ ...added, status: 'renamed' }, { ...added, filename: 'src/components/Panel.css' }, { ...added, filename: 'src/app/inbox/page.tsx' }]) {
    assert.equal((await decision({ files: [file], comments: [wireframe(), yes()] })).state, 'success');
  }
  const result = await decision({ files: Array.from({ length: 8 }, (_, i) => ({ ...added, filename: `src/components/VeryLongComponentName${i}.jsx` })) });
  assert.equal(result.state, 'failure');
  assert.match(result.details[1], /VeryLongComponentName7/);
});

test('API, tests, stories, removed files and unrelated paths are not visible UI', async () => {
  for (const filename of ['src/app/api/inbox/route.tsx', 'src/components/x/Foo.test.tsx', 'src/components/x/Foo.spec.jsx', 'src/components/x/Foo.stories.tsx', 'src/app/__tests__/page.tsx', 'src/lib/Foo.tsx', 'src/components/x/Foo.ts', 'src/application/Foo.tsx']) {
    assert.deepEqual(await decision({ files: [{ filename, status: 'added' }] }), { state: 'success', description: 'No visible UI change', details: [] });
  }
  assert.equal((await decision({ files: [{ ...added, status: 'removed' }] })).description, 'No visible UI change');
  assert.equal((await decision({ author: 'dependabot[bot]', title: 'Bump package', files: [added] })).state, 'success');
});

test('ticket title is strict; unknown project links fall back to the workflow run', async () => {
  for (const invalid of ['No ticket', 'HTPR-1 [FEATURE]', 'HTPR-1 [FEATURE]  UI', 'HTPR-1[FEATURE] UI', 'prefix HTPR-1 [FEATURE] UI']) {
    assert.match((await decision({ title: invalid })).description, /Title names no ticket/);
  }
  const { ticketUrl } = await gate;
  assert.equal(ticketUrl(title, 'run'), 'https://app.hypertask.ai/detail/project-15/7072');
  assert.equal(ticketUrl('YPER4-254 [INFRA] Gate', 'run'), 'https://app.hypertask.ai/detail/project-4060/254');
  assert.equal(ticketUrl('HYFA-1 [FEATURE] UI', 'run'), 'run');
  assert.equal(ticketUrl('unknown', 'run'), 'run');
});

test('lookalike links and unapproved wireframes do not count', async () => {
  for (const text of ['https://example.com/wireframes/a', 'https://hypertask.app.evil/wireframes/a', 'http://hypertask.app/wireframes/a', 'https://hypertask.app/wireframes/']) {
    assert.equal((await decision({ comments: [wireframe({ text }), yes()] })).state, 'failure');
  }
});

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}
const env = { GH_TOKEN: 'github-fixture', MCP_TOKEN: 'hypertask-fixture', REPO: 'fixture/repo', RUN_URL: 'https://github.com/fixture/repo/actions/runs/1' };
const pr = (number = 1, overrides = {}) => ({ number, title: 'HTPR-1 [BUGFIX] Repair', user: { login: 'builder' }, state: 'open', base: { ref: 'production', sha: 'b'.repeat(40) }, head: { sha: number.toString(16).padStart(40, '1') }, ...overrides });
function apiFixture({ prs = [pr()], files = [modified], statuses = [], prError, currentPr } = {}) {
  const calls = [];
  const reads = new Map();
  const github = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (options.method === 'POST') return {};
    if (/\/pulls\?/.test(endpoint)) return prs;
    if (/\/files\?/.test(endpoint)) return files;
    if (/\/statuses\?/.test(endpoint)) return statuses;
    const number = Number(endpoint.split('/').at(-1));
    if (number === prError) throw new Error('fixture read error');
    reads.set(number, (reads.get(number) ?? 0) + 1);
    return currentPr && reads.get(number) > 1 ? currentPr : prs.find((item) => item.number === number);
  };
  return { github, calls };
}
const commentsFetch = async () => response({ success: true, comments: [], nextCursor: null });

test('Hypertask auth, query and cursor pagination match the read API', async () => {
  const requests = [];
  const result = await (await gate).readComments('HTPR-1', { env, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    return response({ success: true, comments: [wireframe()], nextCursor: requests.length === 1 ? '123' : null });
  } });
  assert.equal(result.length, 2);
  assert.equal(requests[0].url, 'https://app.hypertask.ai/api/mcp/comments?ticket_number=HTPR-1&limit=100');
  assert.equal(new URL(requests[1].url).searchParams.get('cursor'), '123');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer hypertask-fixture');
  assert.equal(requests[0].options.method, undefined);
});

test('Hypertask read failures, missing auth, invalid data and repeated cursors fail closed', async () => {
  const { readComments } = await gate;
  await assert.rejects(readComments('HTPR-1', { env: {}, fetchImpl: () => assert.fail('must not fetch') }), /empty/);
  for (const data of [{ success: false, comments: [] }, {}, { comments: [{ text: null }] }, { comments: [], nextCursor: {} }]) {
    await assert.rejects(readComments('HTPR-1', { env, fetchImpl: async () => response(data) }));
  }
  await assert.rejects(readComments('HTPR-1', { env, fetchImpl: async () => response({}, 403) }), /HTTP 403/);
  await assert.rejects(readComments('HTPR-1', { env, fetchImpl: async () => response({ comments: [], nextCursor: '123' }) }), /repeated cursor/);
});

test('GitHub uses bearer REST or gh api fallback without executing PR code', async () => {
  const { createGithub } = await gate;
  const calls = [];
  const github = createGithub({ env, fetchImpl: async (...args) => { calls.push(args); return response({ ok: true }); } });
  await github('repos/fixture/repo/pulls/1');
  await github('repos/fixture/repo/statuses/sha', { method: 'POST', body: { state: 'success' } });
  assert.equal(calls[0][0], 'https://api.github.com/repos/fixture/repo/pulls/1');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer github-fixture');
  assert.equal(JSON.parse(calls[1][1].body).state, 'success');
  const fallback = createGithub({ env: {}, exec: (command, args, options) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', '--method', 'POST', 'repos/fixture/repo/statuses/sha', '--input', '-']);
    assert.equal(options.input, '{"state":"success"}');
    return '{}';
  } });
  await fallback('repos/fixture/repo/statuses/sha', { method: 'POST', body: { state: 'success' } });
  await assert.rejects(createGithub({ env, fetchImpl: async () => response({}, 401) })('repos/fixture/repo/pulls/1'), /HTTP 401/);
});

test('read-only CLI prints success or failure and never posts statuses', async () => {
  const { run } = await gate;
  for (const [title, expected] of [['HTPR-1 [BUGFIX] Repair', 0], ['HTPR-1 [FEATURE] UI', 1]]) {
    const fixture = apiFixture({ prs: [pr(1, { title })] });
    const output = [];
    assert.equal(await run(['--pr', '1'], { env, github: fixture.github, fetchImpl: commentsFetch, log: (line) => output.push(JSON.parse(line)) }), expected);
    assert.equal(output[0].state, expected ? 'failure' : 'success');
    assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
  }
  for (const args of [[], ['--pr'], ['--pr', '0'], ['--pr', 'bad'], ['--unknown'], ['--pr', '1', '--pr', '2']]) {
    await assert.rejects(run(args, { env, github: () => assert.fail('must not fetch') }), /Usage|requires/);
  }
});

test('PR files and open PR lists are paginated', async () => {
  const { run } = await gate;
  const calls = [];
  const github = async (endpoint) => {
    calls.push(endpoint);
    if (/\/pulls\?/.test(endpoint)) return endpoint.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => pr(i + 1)) : [pr(101)];
    if (/\/files\?/.test(endpoint)) return endpoint.endsWith('page=1') ? Array(100).fill(modified) : [modified];
    if (/\/statuses\?/.test(endpoint)) return [{ context: 'ux-signoff', state: 'success', description: 'Bugfix restores intended behaviour; new elements approved' }];
    return pr(Number(endpoint.split('/').at(-1)));
  };
  assert.equal(await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: () => {} }), 0);
  assert.ok(calls.some((endpoint) => /\/pulls\?.*page=2$/.test(endpoint)));
  assert.ok(calls.some((endpoint) => /\/files\?.*page=2$/.test(endpoint)));
  assert.ok(calls.includes('repos/fixture/repo/pulls/101'));
});

test('reconcile publishes failures on head SHAs with ticket targets and skips identical newest statuses', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1, { title })], files: [added] });
  assert.equal(await run(['--reconcile', '--pr', '1'], { env, github: fixture.github, fetchImpl: commentsFetch, log: () => {} }), 0);
  const posted = fixture.calls.find((call) => call.method === 'POST');
  assert.equal(posted.endpoint, `repos/fixture/repo/statuses/${'1'.repeat(40)}`);
  assert.equal(posted.body.context, 'ux-signoff');
  assert.equal(posted.body.state, 'failure');
  assert.equal(posted.body.target_url, 'https://app.hypertask.ai/detail/project-15/7072');
  const unchanged = apiFixture({ prs: [pr(1, { title })], files: [added], statuses: [{ context: 'other', state: 'success' }, posted.body, { ...posted.body, state: 'success' }] });
  assert.equal(await run(['--reconcile'], { env, github: unchanged.github, fetchImpl: commentsFetch, log: () => {} }), 0);
  assert.ok(unchanged.calls.every((call) => call.method !== 'POST'));
  const changed = apiFixture({ prs: [pr(1, { title })], files: [added], statuses: [{ ...posted.body, state: 'success' }, posted.body] });
  await run(['--reconcile'], { env, github: changed.github, fetchImpl: commentsFetch, log: () => {} });
  assert.ok(changed.calls.some((call) => call.method === 'POST'));
});

test('missing secret and read errors publish error and continue the sweep', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1), pr(2)], prError: 1 });
  assert.equal(await run(['--reconcile'], { env, github: fixture.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  assert.deepEqual(fixture.calls.filter((call) => call.method === 'POST').map((call) => call.body.state), ['error', 'success']);
  const missing = apiFixture();
  assert.equal(await run(['--reconcile', '--pr', '1'], { env: { ...env, MCP_TOKEN: '' }, github: missing.github, fetchImpl: () => assert.fail('must not fetch'), log: () => {} }), 2);
  const posted = missing.calls.find((call) => call.method === 'POST');
  assert.equal(posted.body.state, 'error');
  assert.equal(posted.body.description, 'Could not read the ticket; retried every 10 minutes');
  const readFailure = apiFixture();
  assert.equal(await run(['--reconcile'], { env, github: readFailure.github, fetchImpl: async () => response({}, 503), log: () => {} }), 2);
  assert.equal(readFailure.calls.find((call) => call.method === 'POST').body.state, 'error');
});

test('single-PR reconciliation retains a head SHA on metadata read error and touches only that PR', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1), pr(2)], prError: 1 });
  assert.equal(await run(['--reconcile', '--pr', '1'], { env, github: fixture.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  const posts = fixture.calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].endpoint, `repos/fixture/repo/statuses/${pr(1).head.sha}`);
  assert.equal(posts[0].body.state, 'error');
  assert.equal(posts[0].body.target_url, 'https://app.hypertask.ai/detail/project-15/1');
  assert.ok(!fixture.calls.some((call) => call.endpoint === 'repos/fixture/repo/pulls/2'));
});

test('incomplete files, status publication errors and changed PR metadata do not pass', async () => {
  const { run } = await gate;
  const incomplete = apiFixture({ prs: [pr(1, { changed_files: 2 })] });
  assert.equal(await run(['--reconcile'], { env, github: incomplete.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  const race = apiFixture({ currentPr: pr(1, { title: 'HTPR-1 [FEATURE] UI' }) });
  assert.equal(await run(['--reconcile'], { env, github: race.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  assert.equal(race.calls.find((call) => call.method === 'POST').body.state, 'error');
  const failed = apiFixture();
  assert.equal(await run(['--reconcile'], { env, github: (endpoint, options) => {
    if (options?.method === 'POST') throw new Error('write failed');
    return failed.github(endpoint, options);
  }, fetchImpl: commentsFetch, log: () => {} }), 2);
  for (const changed of [pr(1, { state: 'closed' }), pr(1, { base: { ref: 'main' } })]) {
    const skip = apiFixture({ prs: [changed] });
    assert.equal(await run(['--reconcile', '--pr', '1'], { env, github: skip.github, fetchImpl: commentsFetch, log: () => {} }), 0);
    assert.ok(skip.calls.every((call) => call.method !== 'POST'));
  }
});

test('workflow uses trusted pinned production code, correct events, permissions and secret', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/ux-signoff-gate.yml'), 'utf8');
  const trusted = readFileSync(path.join(root, '.github/workflows/feature-flag-gate.yml'), 'utf8');
  assert.match(workflow, /pull_request_target:\s*types: \[opened, synchronize, reopened, edited, ready_for_review\]\s*branches: \[production\]/);
  assert.match(workflow, /cron: ['"]\*\/10 \* \* \* \*['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*contents: read\s*pull-requests: read\s*statuses: write/);
  assert.match(workflow, /group: ux-signoff-gate-\$\{\{ github\.event\.pull_request\.number \|\| 'all' \}\}\s*cancel-in-progress: false/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  for (const action of ['checkout', 'setup-node']) {
    const pin = workflow.match(new RegExp(`actions/${action}@([a-f0-9]{40})`));
    assert.ok(pin);
    assert.ok(trusted.includes(pin[0]));
  }
  assert.match(workflow, /ref: production\s*persist-credentials: false/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /MCP_TOKEN: \$\{\{ secrets\.HYPERTASK_MCP_TOKEN \}\}/);
  assert.match(workflow, /--reconcile --pr "\$PR_NUMBER"/);
  assert.match(workflow, /else\s*node \.github\/scripts\/ux-signoff-gate\.mjs --reconcile\s*fi/);
  assert.doesNotMatch(workflow, /npm |pull_request\.head|git checkout|git fetch/);
});

test('CI policy records ux-signoff without making it required', () => {
  const policy = readFileSync(path.join(root, 'docs/ci-policy.yml'), 'utf8');
  const section = policy.match(/^ux_signoff:\n(?:[ \t].*\n|\n)+/m)?.[0];
  assert.ok(section);
  assert.match(section, /context: ux-signoff/);
  assert.match(section, /workflow: \.github\/workflows\/ux-signoff-gate\.yml/);
  assert.match(section, /script: \.github\/scripts\/ux-signoff-gate\.mjs/);
  assert.match(section, /required: false/);
  assert.match(section, /Infra Manager.*statuses.*seeded.*all open PRs/);
  for (const line of policy.split('\n').filter((line) => /contexts:|required_status_checks:/.test(line))) assert.ok(!line.includes('ux-signoff'));
});
