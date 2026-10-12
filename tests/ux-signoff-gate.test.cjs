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
  const inQuestion = wireframe({ text: '<p>https://hypertask.app/wireframes/htpr-7072</p><p>Question: build it? New elements: DecisionInboxPanel.</p><p>Next: wait</p>', reactions: [{ userId: 6, emoji: '👍' }] });
  assert.equal((await decision({ files: [added], comments: [inQuestion] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe(), yes({ text: 'yes\nNew elements: Decision-Inbox_Panel' })] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: `${approved.text}<span data-type="mention">DecisionInboxPanel</span>`, reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: 'https://hypertask.app/wireframes/a <span data-type="mention">DecisionInboxPanel</span>', reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'failure');
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [added], comments: [yes({ text: 'approved\nNew elements: DecisionInboxPanel' })] })).state, 'success');
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [added], comments: [yes({ text: 'approved\nNew elements: DecisionInboxPanel', agent: { id: 'agent' } })] })).state, 'failure');
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

test('API, tests, stories and unrelated paths are not visible UI', async () => {
  for (const filename of ['src/app/api/inbox/route.tsx', 'src/components/x/Foo.test.tsx', 'src/components/x/Foo.spec.jsx', 'src/components/x/Foo.stories.tsx', 'src/app/__tests__/page.tsx', 'src/lib/Foo.tsx', 'src/components/x/Foo.ts', 'src/application/Foo.tsx']) {
    assert.deepEqual(await decision({ files: [{ filename, status: 'added' }] }), { state: 'success', description: 'No visible UI change', details: [] });
  }
  assert.equal((await decision({ files: [{ ...added, status: 'removed' }] })).state, 'failure');
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
    if (/\/pulls\?/.test(endpoint)) {
      const page = Number(new URL(`https://fixture/${endpoint}`).searchParams.get('page'));
      return prs.slice((page - 1) * 100, page * 100);
    }
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
    if (/\/statuses\?/.test(endpoint)) return [{ context: 'ux-signoff', state: 'success', description: 'Wireframe exempt; new elements approved' }];
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

test('missing secret only affects gated PRs and metadata errors leave heads untouched', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1), pr(2)], prError: 1 });
  assert.equal(await run(['--reconcile'], { env, github: fixture.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  assert.deepEqual(fixture.calls.filter((call) => call.method === 'POST').map((call) => call.body.state), ['success']);
  const missing = apiFixture({ prs: [pr(1, { title })] });
  assert.equal(await run(['--reconcile', '--pr', '1'], { env: { ...env, MCP_TOKEN: '' }, github: missing.github, fetchImpl: () => assert.fail('must not fetch'), log: () => {} }), 2);
  const posted = missing.calls.find((call) => call.method === 'POST');
  assert.equal(posted.body.state, 'error');
  assert.match(posted.body.description, /HYPERTASK_MCP_TOKEN.*configure/);
  const readFailure = apiFixture({ prs: [pr(1, { title })] });
  assert.equal(await run(['--reconcile'], { env, github: readFailure.github, fetchImpl: async () => response({}, 503), log: () => {} }), 0);
  assert.deepEqual(readFailure.calls.filter((call) => call.method === 'POST').map((call) => call.body.state), ['pending']);
});

test('single-PR reconciliation never publishes an unvalidated head on metadata read error', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1), pr(2)], prError: 1 });
  assert.equal(await run(['--reconcile', '--pr', '1'], { env, github: fixture.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  const posts = fixture.calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 0);
  assert.ok(!fixture.calls.some((call) => call.endpoint === 'repos/fixture/repo/pulls/2'));
});

test('incomplete files, status publication errors and changed PR metadata do not pass', async () => {
  const { run } = await gate;
  const incomplete = apiFixture({ prs: [pr(1, { changed_files: 2 })] });
  assert.equal(await run(['--reconcile'], { env, github: incomplete.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  const race = apiFixture({ currentPr: pr(1, { title: 'HTPR-1 [FEATURE] UI' }) });
  assert.equal(await run(['--reconcile'], { env, github: race.github, fetchImpl: commentsFetch, log: () => {} }), 0);
  assert.equal(race.calls.find((call) => call.method === 'POST').body.state, 'failure');
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
  assert.match(workflow, /group: ux-signoff-gate\s*cancel-in-progress: false/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  for (const action of ['checkout', 'setup-node']) {
    const pin = workflow.match(new RegExp(`actions/${action}@([a-f0-9]{40})`));
    assert.ok(pin);
    assert.ok(trusted.includes(pin[0]));
  }
  assert.match(workflow, /ref: production\s*persist-credentials: false/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /MCP_TOKEN: \$\{\{ secrets\.HYPERTASK_MCP_TOKEN \}\}/);
  assert.match(workflow, /run: node \.github\/scripts\/ux-signoff-gate\.mjs --reconcile\s*$/);
  assert.doesNotMatch(workflow, /--pr|EVENT_NAME|PR_NUMBER/);
  assert.doesNotMatch(workflow, /npm |pull_request\.head|git checkout|git fetch/);
});

test('item 1: all agent attribution markers reject comments and reactions', async () => {
  for (const marker of ['agent', 'agent_display_name', 'agentId', 'isAgent']) {
    for (const value of [{ id: 'runner' }, 'Private agent', true, false, 0, '']) {
      assert.equal((await decision({ comments: [wireframe(), yes({ [marker]: value })] })).state, 'failure', marker);
      assert.equal((await decision({ comments: [wireframe({ reactions: [{ userId: 6, emoji: '👍', [marker]: value }] })] })).state, 'failure', marker);
    }
    assert.equal((await decision({ comments: [wireframe(), yes({ [marker]: null })] })).state, 'success');
  }
});

test('item 2: latest wireframe and newest subsequent human verdict decide', async () => {
  const old = wireframe({ reactions: [{ userId: 6, emoji: '👍' }] });
  const latest = wireframe({ id: 3, text: 'https://hypertask.app/wireframes/replacement', createdAt: '2026-10-10T12:02:00Z' });
  assert.equal((await decision({ comments: [latest, yes(), old] })).state, 'failure');
  const approved = { ...latest, reactions: [{ userId: 6, emoji: '✅' }] };
  assert.equal((await decision({ comments: [old, approved] })).state, 'success');
  const later = (text, extra = {}) => yes({ id: 4, text, createdAt: '2026-10-10T12:03:00Z', ...extra });
  for (const text of ['no', 'nope', 'not this', 'reject this', "don't ship", 'yes but change it', 'use this instead']) {
    assert.equal((await decision({ comments: [later(text), approved, yes()] })).state, 'failure', text);
  }
  assert.equal((await decision({ comments: [approved, later('no'), later('yes', { id: 5, createdAt: '2026-10-10T12:04:00Z' })] })).state, 'success');
  assert.equal((await decision({ comments: [approved, later('no'), later('A neutral follow-up', { createdAt: '2026-10-10T12:05:00Z' })] })).state, 'failure');
  assert.equal((await decision({ comments: [approved, later('no', { agent_display_name: 'Runner' })] })).state, 'success');
  assert.equal((await decision({ comments: [yes()] })).state, 'failure');
});

test('item 3: edits require a timestamped later reaction or a separate later human yes', async () => {
  const edit = '2026-10-10T12:02:00Z';
  for (const field of ['updatedAt', 'editedAt']) {
    const edited = wireframe({ [field]: edit, reactions: [{ userId: 6, emoji: '👍' }] });
    assert.equal((await decision({ comments: [edited, yes()] })).state, 'failure');
    for (const createdAt of [undefined, 'invalid', '2026-10-10T12:01:00Z', edit]) {
      assert.equal((await decision({ comments: [{ ...edited, reactions: [{ userId: 6, emoji: '👍', createdAt }] }] })).state, 'failure');
    }
    assert.equal((await decision({ comments: [{ ...edited, reactions: [{ userId: 6, emoji: '👍', createdAt: '2026-10-10T12:03:00Z' }] }] })).state, 'success');
    assert.equal((await decision({ comments: [edited, yes({ createdAt: '2026-10-10T12:03:00Z' })] })).state, 'success');
    assert.equal((await decision({ comments: [edited, yes({ createdAt: edit })] })).state, 'failure');
    assert.equal((await decision({ comments: [{ ...edited, [field]: 'invalid' }, yes({ createdAt: '2026-10-10T12:03:00Z' })] })).state, 'failure');
  }
  const both = wireframe({ updatedAt: edit, editedAt: '2026-10-10T12:04:00Z' });
  assert.equal((await decision({ comments: [both, yes({ createdAt: '2026-10-10T12:03:00Z' })] })).state, 'failure');
  assert.equal((await decision({ comments: [wireframe({ reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'success');
});

test('item 4: exemptions precede ticket reads and secret checks', async () => {
  const { run } = await gate;
  for (const [prTitle, files] of [
    [title, [{ filename: 'docs/guide.md', status: 'modified' }]],
    ['HTPR-1 [BUGFIX] Repair', [modified]],
    ['HTPR-1 [BUGFIX] Remove screen', [{ ...modified, status: 'removed' }]],
    ['YPER4-254 [INFRA] Refactor', [modified]],
  ]) {
    for (const MCP_TOKEN of ['', env.MCP_TOKEN]) {
      const fixture = apiFixture({ prs: [pr(1, { title: prTitle })], files });
      assert.equal(await run(['--reconcile'], { env: { ...env, MCP_TOKEN }, github: fixture.github, fetchImpl: () => assert.fail('exempt PR must not read Hypertask'), log: () => {} }), 0);
      assert.equal(fixture.calls.find((call) => call.method === 'POST').body.state, 'success');
    }
  }
  for (const prTitle of [title, 'HTPR-1 [BUGFIX] Repair', 'YPER4-254 [INFRA] New element']) {
    const fixture = apiFixture({ prs: [pr(1, { title: prTitle })], files: [added] });
    assert.equal(await run(['--reconcile'], { env: { ...env, MCP_TOKEN: '' }, github: fixture.github, fetchImpl: () => assert.fail('missing token'), log: () => {} }), 2);
    assert.equal(fixture.calls.find((call) => call.method === 'POST').body.state, 'error');
  }
});

test('item 5: legacy pages, shared styles and removed UI are visible but APIs are not', async () => {
  for (const filename of ['src/pages/home.tsx', 'src/pages/account/index.jsx', 'src/styles/globals.css', 'src/styles/theme.scss', modified.filename, 'src/app/settings/page.tsx']) {
    for (const status of ['modified', 'removed']) {
      assert.equal((await decision({ files: [{ filename, status }] })).state, 'failure', filename);
      assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Restore', files: [{ filename, status }] })).state, 'success', filename);
    }
  }
  for (const filename of ['src/pages/api/test.tsx', 'src/app/api/test/route.tsx', 'src/pages/home.test.tsx', 'src/styles/theme.stories.css']) {
    assert.equal((await decision({ files: [{ filename, status: 'removed' }] })).description, 'No visible UI change');
  }
});

test('item 6: exact normalized New elements entries use index parent identities', async () => {
  const react = [{ userId: 6, emoji: '👍' }];
  const named = (text) => wireframe({ text: `https://hypertask.app/wireframes/a\n${text}`, reactions: react });
  assert.equal((await decision({ files: [added], comments: [named('New elements: Decision-Inbox_Panel')] })).state, 'success');
  const panel = { ...added, filename: 'src/components/Panel.tsx' };
  for (const text of ['New elements: DecisionInboxPanel', 'Panel is discussed here', 'New elements: none', 'New elements: none\nPanel', '<p>New elements: none</p><p>Panel</p>']) {
    assert.equal((await decision({ files: [panel], comments: [named(text)] })).state, 'failure', text);
  }
  const indices = ['First', 'Second'].map((name) => ({ ...added, filename: `src/components/${name}/index.tsx` }));
  assert.equal((await decision({ files: indices, comments: [named('New elements: First, Second')] })).state, 'success');
  assert.equal((await decision({ files: indices, comments: [named('New elements: First')] })).state, 'failure');
  assert.equal((await decision({ files: indices, comments: [named('New elements: index')] })).state, 'failure');
  assert.equal((await decision({ files: [panel], comments: [wireframe(), yes({ text: '<p>yes</p><p>New elements: Panel</p>' })] })).state, 'success');
  const stale = named('New elements: Panel');
  const latest = wireframe({ createdAt: '2026-10-10T12:02:00Z', reactions: react });
  assert.equal((await decision({ files: [panel], comments: [stale, latest] })).state, 'failure');
  assert.equal((await decision({ files: [panel], comments: [wireframe(), yes({ text: 'yes\nNew elements: Panel' }), yes({ id: 3, text: 'yes\nNew elements: none', createdAt: '2026-10-10T12:02:00Z' })] })).state, 'failure');
});

test('item 7: reconciliation caches, caps reads including pages and stops after 429 or 5xx', async () => {
  const { run } = await gate;
  const prs = Array.from({ length: 124 }, (_, i) => pr(i + 1, { title: `HTPR-${Math.max(1, i)} [FEATURE] UI` }));
  const execute = async (fetchImpl) => {
    const fixture = apiFixture({ prs });
    const logs = [];
    assert.equal(await run(['--reconcile'], { env, github: fixture.github, fetchImpl, log: (line) => logs.push(JSON.parse(line)) }), 0);
    return { posts: fixture.calls.filter((call) => call.method === 'POST'), logs };
  };
  let reads = 0;
  const capped = await execute(async () => { reads++; return response({ comments: [], nextCursor: null }); });
  assert.equal(reads, 120);
  assert.equal(capped.posts.length, 124);
  assert.equal(capped.posts.filter((post) => post.body.state === 'pending').length, 3);
  assert.equal(capped.logs.filter((line) => line.state === 'deferred').length, 3);
  for (const status of [429, 500, 503]) {
    reads = 0;
    const stopped = await execute(async () => ++reads === 1 ? response({ comments: [] }) : response({}, status));
    assert.equal(reads, 2, `HTTP ${status}`);
    assert.equal(stopped.posts.length, 124);
    assert.ok(stopped.posts.every((post) => post.body.state !== 'error'));
    assert.ok(stopped.logs.some((line) => line.state === 'deferred' && line.description.includes(`HTTP ${status}`)));
  }
  reads = 0;
  const paged = await execute(async () => response({ comments: [], nextCursor: String(++reads) }));
  assert.equal(reads, 120);
  assert.equal(paged.posts.length, 124);
  assert.deepEqual([...new Set(paged.posts.map((post) => post.body.state))], ["pending"]);
  assert.equal(paged.logs.filter((line) => line.state === 'deferred').length, 124);
  const mixed = apiFixture({ prs: [pr(1, { title }), pr(2, { title: 'HTPR-2 [FEATURE] UI' }), pr(3)] });
  reads = 0;
  assert.equal(await run(['--reconcile'], { env, github: mixed.github, fetchImpl: async () => { reads++; return response({}, 429); }, log: () => {} }), 0);
  assert.equal(reads, 1);
  assert.deepEqual(mixed.calls.filter((call) => call.method === 'POST').map((call) => [call.endpoint, call.body.state]), [[`repos/fixture/repo/statuses/${pr(1).head.sha}`, 'pending'], [`repos/fixture/repo/statuses/${pr(2).head.sha}`, 'pending'], [`repos/fixture/repo/statuses/${pr(3).head.sha}`, 'success']]);
});

test('item 8: re-read immediately before posting and evaluate changed heads with fresh files', async () => {
  const { run } = await gate;
  for (const oldError of [false, true]) {
    const original = pr(1);
    const current = pr(1, { title, head: { sha: 'c'.repeat(40) } });
    const fixture = apiFixture({ prs: [original], currentPr: current });
    let filesReads = 0;
    const github = (endpoint, options) => {
      if (/\/files\?/.test(endpoint)) {
        filesReads++;
        if (oldError && filesReads === 1) throw new Error('old head files failed');
        return Promise.resolve(filesReads === 1 ? [modified] : [added]);
      }
      return fixture.github(endpoint, options);
    };
    assert.equal(await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: () => {} }), 0);
    assert.equal(filesReads, 2);
    const posts = fixture.calls.filter((call) => call.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].endpoint, `repos/fixture/repo/statuses/${current.head.sha}`);
    assert.equal(posts[0].body.state, 'failure');
    assert.ok(fixture.calls.at(-2).endpoint.endsWith('/pulls/1'));
  }
  for (const finalReadFailure of [false, true]) {
    const fixture = apiFixture();
    let reads = 0;
    const github = (endpoint, options) => {
      if (/\/pulls\/1$/.test(endpoint) && ++reads > 1) {
        if (finalReadFailure) throw new Error('cannot validate current head');
        return Promise.resolve(pr(1, { head: { sha: reads.toString(16).padStart(40, 'a') } }));
      }
      return fixture.github(endpoint, options);
    };
    await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: () => {} });
    assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
    assert.ok(reads <= 4);
  }
});

test('item 9: all workflow triggers fully reconcile under one trusted global group', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/ux-signoff-gate.yml'), 'utf8');
  assert.match(workflow, /concurrency:\s*group: ux-signoff-gate\s*cancel-in-progress: false/);
  assert.match(workflow, /run: node \.github\/scripts\/ux-signoff-gate\.mjs --reconcile\s*$/);
  assert.doesNotMatch(workflow, /--pr|EVENT_NAME|PR_NUMBER|pull_request\.head/);
  assert.match(workflow, /ref: production\s*persist-credentials: false/);
  assert.match(workflow, /permissions:\s*contents: read\s*pull-requests: read\s*statuses: write\s*concurrency:/);
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

test('status cursor: every PR is read within ceil(reads / budget) sweeps and statuses per head stay bounded', async () => {
  const { run } = await gate;
  for (const pages of [1, 13]) {
    const total = 650;
    // Zero padding keeps every head SHA unique (the shared fixture pads with 1s, so PR 1 and PR 17 collide).
    const prs = Array.from({ length: total }, (_, i) => pr(i + 1, { title: `HTPR-${i + 1} [FEATURE] UI`, head: { sha: (i + 1).toString(16).padStart(40, '0') } }));
    const store = new Map();
    let clock = Date.parse('2026-10-12T00:00:00Z');
    const github = async (endpoint, options = {}) => {
      if (options.method === 'POST') {
        const sha = endpoint.split('/').at(-1);
        store.set(sha, [{ ...options.body, updated_at: new Date(clock).toISOString() }, ...(store.get(sha) ?? [])]);
        return {};
      }
      const page = Number(new URL(`https://fixture/${endpoint}`).searchParams.get('page'));
      if (/\/pulls\?/.test(endpoint)) return prs.slice((page - 1) * 100, page * 100);
      if (/\/files\?/.test(endpoint)) return [modified];
      if (/\/statuses\?/.test(endpoint)) return page === 1 ? (store.get(endpoint.split('/')[4]) ?? []) : [];
      return prs.find((item) => item.number === Number(endpoint.split('/').at(-1)));
    };
    const read = new Set();
    const fetchImpl = async (url) => {
      const params = new URL(String(url)).searchParams;
      read.add(params.get('ticket_number'));
      const next = Number(params.get('cursor') ?? 0) + 1;
      return response({ comments: [], nextCursor: next < pages ? String(next) : null });
    };
    const sweep = async () => {
      await run(['--reconcile'], { env, github, fetchImpl, log: () => {}, now: () => clock });
      clock += 600000;
    };
    // Whole tickets fit floor(120 / pages) per sweep; a ticket cut off mid-pagination is retried first next sweep.
    const sweeps = Math.ceil(total / Math.floor(120 / pages));
    for (let index = 0; index < sweeps; index++) await sweep();
    assert.equal(read.size, total, `${pages} page(s): every PR read within ${sweeps} sweeps`);
    // A further day of sweeps: about one heartbeat per head per hour, never one per sweep.
    for (let index = 0; index < 144; index++) await sweep();
    const perHead = Math.max(...[...store.values()].map((list) => list.length));
    assert.ok(perHead <= 2 + 24 + 1, `${pages} page(s): ${perHead} statuses on one head`);
  }
});

test('a Hypertask outage turns an earlier green to pending; budget exhaustion keeps it', async () => {
  const { run } = await gate;
  const green = [{ context: 'ux-signoff', state: 'success', description: 'Wireframe and new elements have UX signoff', updated_at: new Date().toISOString() }];
  const outage = apiFixture({ prs: [pr(1, { title: 'HTPR-2 [FEATURE] UI' })], statuses: green });
  await run(['--reconcile'], { env, github: outage.github, fetchImpl: async () => response({}, 503), log: () => {} });
  assert.deepEqual(outage.calls.filter((call) => call.method === 'POST').map((call) => call.body.state), ['pending']);
  const prs = Array.from({ length: 121 }, (_, i) => pr(i + 1, { title: `HTPR-${i + 1} [FEATURE] UI`, head: { sha: (i + 1).toString(16).padStart(40, '0') } }));
  const busy = apiFixture({ prs, statuses: green });
  await run(['--reconcile'], { env, github: busy.github, fetchImpl: commentsFetch, log: () => {} });
  assert.equal(busy.calls.filter((call) => call.method === 'POST').length, 120);
});

test("Valentin's yes that quotes the wireframe link still approves it", async () => {
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<p>yes https://hypertask.app/wireframes/htpr-1</p>' })] })).state, 'success');
});
