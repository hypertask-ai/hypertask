const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

const access = load('src/utils/controllers/projects/getAllIncludes.ts', {
  '@/lib/agents/publicAgent': {},
  '@/lib/cycles': {},
  '@/lib/agents/visibility': {},
  '@/utils/controllers/notifications/visibleInboxScope': {},
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const flag = 'htpr-7298-standalone-pages';

function matches(row, where = {}) {
  if (row == null) return false;
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return expected.some((part) => matches(row, part));
    if (key === 'AND') return expected.every((part) => matches(row, part));
    const value = row[key];
    if (expected === null || typeof expected !== 'object') return value === expected;
    if ('some' in expected) return value.some((item) => matches(item, expected.some));
    if ('not' in expected) return value !== expected.not;
    if ('in' in expected) return expected.in.includes(value);
    if ('contains' in expected) return String(value).toLowerCase().includes(expected.contains.toLowerCase());
    return matches(value, expected);
  });
}

function project(row, query = {}) {
  if (row == null || (query.where && !matches(row, query.where))) return null;
  const output = query.select ? {} : { ...row };
  for (const [key, selection] of Object.entries(query.select ?? query.include ?? {})) {
    if (selection === true) output[key] = row[key];
    else if (Array.isArray(row[key])) output[key] = row[key].filter((item) => matches(item, selection.where)).map((item) => project(item, selection));
    else output[key] = project(row[key], selection);
  }
  return output;
}

function harness(options = {}) {
  const state = {
    projects: [
      { id: 1, title: 'Page board', status: 'Normal', teamId: 'team', ownerId: 1, members: [{ userId: 3, agentId: null }, { userId: 5, agentId: 'agent-only' }] },
      { id: 2, title: 'Ticket board', status: 'Normal', teamId: 'team', ownerId: 2, members: [{ userId: 3, agentId: null }] },
      { id: 3, title: 'Foreign team', status: 'Normal', teamId: 'foreign', ownerId: 3, members: [] },
      { id: 4, title: 'Archived board', status: 'Archive', teamId: 'team', ownerId: 3, members: [] },
      { id: 5, title: 'Deleted board', status: 'Deleted', teamId: 'team', ownerId: 3, members: [] },
    ],
    tasks: [
      { id: 10, projectId: 2, title: 'SECRET-TICKET', ticketNumber: 'SECRET-987', uniqueIndex: 987, status: 'Normal' },
      { id: 11, projectId: 1, title: 'Visible ticket', ticketNumber: 'A-11', uniqueIndex: 11, status: 'Normal' },
      { id: 12, projectId: 3, title: 'Foreign ticket', status: 'Normal' },
      { id: 13, projectId: 1, title: 'Deleted ticket', status: 'Deleted' },
    ],
    pages: [
      { id: 20, publicId: 'page', projectId: 1, taskId: 10, title: 'Page title', contentHtml: '<p>body</p>', contentText: 'body', parentPageId: null, archived: false, version: 1, createdAt: new Date(0), updatedAt: new Date(0) },
      { id: 21, publicId: 'hidden-child', projectId: 2, taskId: 10, title: 'SECRET-CHILD', parentPageId: 20, archived: false },
      { id: 22, publicId: 'visible-child', projectId: 1, taskId: null, title: 'Visible child', parentPageId: 20, archived: false },
      { id: 23, publicId: 'archived-page', projectId: 1, taskId: 11, title: 'Archived page', archived: true },
      { id: 24, publicId: 'archived-board-page', projectId: 4, taskId: null, title: 'Archived board page', archived: false },
      { id: 25, publicId: 'deleted-board-page', projectId: 5, taskId: null, title: 'Deleted board page', archived: false },
      { id: 26, publicId: 'old-writer-page', projectId: 1, taskId: 11, title: 'Old writer', archived: false },
    ],
    links: [{ id: 1, pageId: 20, taskId: 10, createdAt: new Date(0) }, { id: 2, pageId: 20, taskId: 11, createdAt: new Date(1) }],
  };
  const queries = [];
  let lock = false;
  const userId = options.userId ?? 1;
  const taskRow = (task) => task && ({ ...task, project: state.projects.find((p) => p.id === task.projectId) });
  const pageRow = (page) => ({ ...page, project: state.projects.find((p) => p.id === page.projectId), task: taskRow(state.tasks.find((t) => t.id === page.taskId)) ?? null, links: state.links.filter((l) => l.pageId === page.id).map((l) => ({ ...l, task: taskRow(state.tasks.find((t) => t.id === l.taskId)) })), subPages: state.pages.filter((p) => p.parentPageId === page.id) });
  const find = (rows, query) => rows.filter((row) => matches(row, query.where)).map((row) => project(row, query));
  const prisma = {
    project: {
      findFirst: async (query) => find(state.projects, query)[0] ?? null,
      findMany: async (query) => find(state.projects, query),
    },
    task: {
      findFirst: async (query) => find(state.tasks.map(taskRow), query)[0] ?? null,
      findUnique: async (query) => find(state.tasks.map(taskRow), query)[0] ?? null,
    },
    page: {
      findUnique: async (query) => { queries.push(query); return find(state.pages.map(pageRow), query)[0] ?? null; },
      findFirst: async (query) => { queries.push(query); return find(state.pages.map(pageRow), query)[0] ?? null; },
      findMany: async (query) => { queries.push(query); return find(state.pages.map(pageRow), query); },
      create: async ({ data }) => {
        const { links, ...fields } = data;
        const page = { id: 100, publicId: 'created', title: 'Untitled', version: 1, ...fields };
        state.pages.push(page);
        if (links) state.links.push({ id: 100, pageId: page.id, ...links.create });
        return page;
      },
      update: async ({ where, data }) => { assert.ok(lock); const row = state.pages.find((p) => p.id === where.id); Object.assign(row, data); return row; },
    },
    pageTaskLink: {
      upsert: async ({ where, create }) => {
        assert.ok(lock, 'link mutation holds page lock');
        const old = state.links.find((l) => l.pageId === where.pageId_taskId.pageId && l.taskId === where.pageId_taskId.taskId);
        if (!old) state.links.push({ id: 100, createdAt: new Date(), ...create });
        return old ?? create;
      },
      deleteMany: async ({ where }) => { assert.ok(lock); state.links = state.links.filter((l) => !matches(l, where)); },
      findFirst: async (query) => find(state.links.toSorted((a, b) => a.createdAt - b.createdAt || a.id - b.id), query)[0] ?? null,
    },
    $queryRaw: async (strings) => { assert.match(strings.join(''), /FROM "Page".*FOR UPDATE/); lock = true; return [{ id: 20 }]; },
    $transaction: async (callback) => {
      const original = structuredClone(state);
      try { return await callback(prisma); }
      catch (error) { Object.assign(state, original); throw error; }
      finally { lock = false; }
    },
  };
  const service = load('src/utils/controllers/pages/pageService.ts', {
    '@/lib/prisma': { default: prisma },
    '@/utils/controllers/projects/getAllIncludes': access,
    '@/utils/controllers/turbopuffer/turbopufferHelper': { convertToPlain: (value) => value, upsertPageToTurbopuffer: async () => {}, deletePageFromTurbopuffer: async () => {} },
    '@/utils/helperFunctions/markdownToHtml': { markdownToHtml: (value) => value },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (value) => value },
  });
  const mocks = {
    '@/lib/prisma': { default: prisma },
    '@/utils/controllers/projects/getAllIncludes': access,
    '@/utils/controllers/pages/pageService': service,
    '@/lib/auth/currentUser': { loadCurrentUser: async () => options.noSession ? null : { userId } },
    '@/lib/flags': { HTPR_6924_REST_COMPAT_FLAG: 'compat', isFeatureEnabled: async (key) => key === flag ? options.flag !== false : Boolean(options.compat) },
    'next/headers': { cookies: async () => ({ get: () => options.noSession ? undefined : { value: 'synthetic' } }) },
    '@/utils/edgeHelpers': { isValidUser: () => ({ isValid: true, user: { id: userId } }) },
    '@/lib/api/rateLimit': { checkRestRateLimit: async () => options.rateLimited ? new Response('{}', { status: 429 }) : null },
  };
  async function request(suffix, method = 'GET', body, query = '') {
    const route = load(`src/app/api/pages/${suffix}/route.ts`, mocks);
    const response = await route[method]({ headers: new Headers(), nextUrl: new URL('https://fixture.invalid/?' + query), json: async () => body }, { params: Promise.resolve({ publicId: 'page' }) });
    return { status: response.status, body: await response.json() };
  }
  return { state, service, request, queries, prisma };
}

for (const [name, userId, allowed] of [['non-member refused', 2, false], ['agent-attributed human refused', 5, false], ['owner allowed', 1, true], ['human member allowed', 3, true]]) {
  test(`REST get: ${name}`, async () => {
    const h = harness({ userId });
    const result = await h.request('[publicId]');
    assert.equal(result.status, allowed ? 200 : 404);
    if (!allowed) assert.doesNotMatch(JSON.stringify(result), /Page title|SECRET/);
  });
}
for (const [name, userId, visible] of [['inaccessible ticket metadata null', 1, false], ['accessible ticket returned', 3, true]]) {
  test(`REST get: ${name}`, async () => {
    const h = harness({ userId });
    const { body } = await h.request('[publicId]');
    assert.equal(body.page.taskId, visible ? 10 : null);
    assert.equal(body.page.task?.id ?? null, visible ? 10 : null);
    assert.equal(body.page.linkedTasks.length, visible ? 2 : 1);
    if (!visible) assert.doesNotMatch(JSON.stringify(body), /SECRET|987|hidden-child/);
    assert.deepEqual(body.page.subPages.map((p) => p.publicId), ['visible-child']);
  });
}
for (const [name, userId, visible] of [['ticket-only viewer omits linked page', 2, false], ['both-board viewer sees linked page', 3, true]]) {
  test(`ticket list: ${name}`, async () => {
    const h = harness({ userId });
    const { body, status } = await h.request('list', 'GET', undefined, 'task_id=10');
    assert.equal(status, 200);
    assert.equal(body.pages.some((p) => p.publicId === 'page'), visible);
    assert.equal(body.pages.length, visible ? 2 : 1);
    if (!visible) assert.doesNotMatch(JSON.stringify(body), /Page title/);
  });
}
test('legacy unlinked ticket page remains listed exactly once', async () => {
  const h = harness();
  const rows = await h.service.listPages({ taskId: 11, userId: 1 });
  assert.equal(rows.filter((p) => p.publicId === 'old-writer-page').length, 1);
  assert.equal(rows.some((p) => p.publicId === 'archived-page'), false);
  assert.equal(rows.filter((p) => p.publicId === 'page').length, 1);
});
for (const [name, options, taskId, expected] of [
  ['ticket board not writable', { userId: 1 }, 10, 404],
  ['both boards writable', { userId: 3 }, 10, 200],
  ['other team refused', { userId: 3 }, 12, 403],
  ['same team allowed', { userId: 3 }, 11, 200],
  ['Deleted ticket refused', { userId: 3 }, 13, 404],
  ['Normal ticket allowed', { userId: 3 }, 11, 200],
  ['flag off refused', { userId: 3, flag: false }, 11, 404],
  ['flag on allowed', { userId: 3 }, 11, 200],
]) {
  test(`link: ${name}`, async () => {
    const h = harness(options);
    const before = plain(h.state);
    const result = await h.request('[publicId]/links', 'POST', { task_id: taskId });
    assert.equal(result.status, expected);
    if (expected !== 200) assert.deepEqual(plain(h.state), before);
    else {
      await h.request('[publicId]/links', 'POST', { task_id: taskId });
      assert.equal(h.state.links.filter((l) => l.pageId === 20 && l.taskId === taskId).length, 1);
    }
  });
}
for (const [name, userId, expected] of [['ticket-board-only writer refused', 2, 404], ['page-board writer allowed and promotes pointer', 1, 200]]) {
  test(`unlink: ${name}`, async () => {
    const h = harness({ userId });
    const result = await h.request('[publicId]/links', 'DELETE', { task_id: 10 });
    assert.equal(result.status, expected);
    assert.equal(h.state.pages[0].taskId, expected === 200 ? 11 : 10);
    if (expected === 200) {
      await h.request('[publicId]/links', 'DELETE', { task_id: 11 });
      assert.equal(h.state.pages[0].taskId, null);
    }
  });
}
test('unlink flag off is refused without mutations / flag on is allowed', async () => {
  for (const enabled of [false, true]) {
    const h = harness({ flag: enabled });
    const result = await h.request('[publicId]/links', 'DELETE', { task_id: 10 });
    assert.equal(result.status, enabled ? 200 : 404);
    assert.equal(h.state.links.length, enabled ? 1 : 2);
  }
});
for (const [name, options, expected] of [['flag off refused', { flag: false }, 404], ['flag on board owner allowed', {}, 200], ['board outsider refused', { userId: 2 }, 404], ['board member allowed', { userId: 3 }, 200]]) {
  test(`standalone create: ${name}`, async () => {
    const h = harness(options);
    const result = await h.request('create', 'POST', { project_id: 1, content: '' });
    assert.equal(result.status, expected);
    if (expected === 200) assert.equal(h.state.pages.at(-1).taskId, null);
  });
}
test('create parent on another board refused / same owning board allowed', async () => {
  for (const [parentId, allowed] of [[21, false], [22, true]]) {
    const h = harness();
    const result = await h.request('create', 'POST', { project_id: 1, parent_page_id: parentId, content: '' });
    assert.equal(result.status, allowed ? 200 : 404);
  }
});
test('ticket create writes link with page in same transaction regardless of flag', async () => {
  for (const enabled of [false, true]) {
    const h = harness({ flag: enabled });
    const result = await h.request('create', 'POST', { task_id: 11, content: '' });
    assert.equal(result.status, 200);
    assert.equal(h.state.links.at(-1).pageId, h.state.pages.at(-1).id);
    assert.equal(h.state.links.at(-1).taskId, 11);
    assert.equal(h.state.pages.at(-1).projectId, 1);
  }
});
for (const [name, enabled, expected] of [['flag off refused', false, 404], ['flag on allowed', true, 200]]) {
  test(`board list: ${name}`, async () => {
    const h = harness({ userId: 3, flag: enabled });
    const result = await h.request('list', 'GET', undefined, 'scope=all');
    assert.equal(result.status, expected);
    if (enabled) {
      assert.equal(result.body.count, result.body.pages.length);
      assert.ok(result.body.pages.every((p) => [1, 2, 3].includes(p.projectId)));
      assert.ok(result.body.pages.every((p) => p.project.title));
    }
  });
}
test('board list restricts accessible Normal boards, archived filter, query and visible linked tickets', async () => {
  const h = harness();
  const normal = await h.request('list', 'GET', undefined, 'scope=all');
  assert.ok(normal.body.pages.every((p) => p.projectId === 1));
  assert.equal(normal.body.count, normal.body.pages.length);
  assert.doesNotMatch(JSON.stringify(normal), /SECRET|Archived board|Deleted board/);
  const archived = await h.request('list', 'GET', undefined, 'scope=board&project_id=1&archived=1');
  assert.deepEqual(archived.body.pages.map((p) => p.publicId), ['archived-page']);
  assert.equal(archived.body.count, 1);
  const query = await h.request('list', 'GET', undefined, 'scope=all&q=Old%20writer');
  assert.deepEqual(query.body.pages.map((p) => p.publicId), ['old-writer-page']);
  assert.equal(query.body.count, 1);
});
test('search follows page board and redacts hidden task ID / visible task ID retained', async () => {
  for (const userId of [1, 3]) {
    const h = harness({ userId });
    const rows = await h.service.searchPages({ query: 'body', projectIds: [1], userId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].taskId, userId === 1 ? null : 10);
    assert.equal(rows[0].projectId, 1);
  }
});
test('new session endpoints reject a bearer token without a browser session', async () => {
  const h = harness({ noSession: true });
  assert.equal((await h.request('[publicId]/links', 'POST', { task_id: 11 })).status, 401);
});
test('link endpoint reuses compat write rate limiting before mutation', async () => {
  const h = harness({ compat: true, rateLimited: true });
  const before = plain(h.state);
  assert.equal((await h.request('[publicId]/links', 'POST', { task_id: 11 })).status, 429);
  assert.deepEqual(plain(h.state), before);
});


test('standalone flag defaults Owner + QA and all new APIs gate on the same server flag', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const definition = load('src/lib/flags/definitions/htpr-7298-standalone-pages.ts', {}).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, 'feature');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA');
  assert.equal(definition.shippedOn, '2026-10-18');
  assert.ok(definition.releaseRisk.risk && definition.releaseRisk.reason);
  for (const route of ['create', 'list', '[publicId]/links']) {
    assert.match(fs.readFileSync(path.join(root, `src/app/api/pages/${route}/route.ts`), 'utf8'), /isFeatureEnabled\(HTPR_7298_STANDALONE_PAGES_FLAG, userId\)/);
  }
  const runbook = fs.readFileSync(path.join(root, 'docs/standalone-pages-rollout.md'), 'utf8');
  assert.match(runbook, /all old readers, writers, movers and task-delete workers/);
  assert.match(runbook, /Never revert to task-owned authorization/);
});
