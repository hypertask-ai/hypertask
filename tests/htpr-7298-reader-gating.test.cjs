const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');
const { harness } = require('./htpr-7298-browser.test.cjs');

const flag = 'htpr-7298-standalone-pages';
const aiOperations = {
  get: ['getPage', 'createGetPageTool', 'hypertask_get_page'],
  update: ['updatePage', 'createUpdatePageTool', 'hypertask_update_page'],
  versions: ['pageHistory', 'createPageHistoryTool', 'hypertask_page_history'],
  restore: ['pageHistory', 'createPageHistoryTool', 'hypertask_page_history'],
  archive: ['pageHistory', 'createPageHistoryTool', 'hypertask_page_history'],
  list: ['listPages', 'createListPagesTool', 'hypertask_list_pages'],
  search: ['searchPages', 'createSearchPagesTool', 'hypertask_search_pages'],
};

function fixture(enabled) {
  const h = harness({ userId: 3, flag: enabled });
  const flagCalls = [];
  const effects = [];
  // Keep the actual shared reader and ORM predicates; spy only on post-authorization effects.
  for (const name of ['updatePage', 'restorePageVersion', 'archivePage', 'listPageVersions']) {
    h.service[name] = async () => { effects.push(name); return name === 'listPageVersions' ? [] : h.state.pages[0]; };
  }
  h.prisma.task.findUnique = async () => h.state.tasks.find((t) => t.id === 11);
  const mocks = {
    '@/lib/flags': { isFeatureEnabled: async (key, userId) => {
      assert.equal(key, flag);
      assert.equal(userId, 3, 'evaluate the human credential owner, not agent id');
      flagCalls.push([key, userId]);
      return enabled;
    } },
    '@/lib/prisma': { default: h.prisma },
    '@/utils/controllers/pages/pageService': h.service,
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (fn) => fn },
    '@/lib/mcp/auth': { validateMcpAuth: async () => ({ user: { id: 3 }, agentId: 'credential-agent' }), checkMcpRateLimit: async () => null },
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/tasks/services': { validateProjectAccess: async () => ({ error: null }) },
    '@/lib/mcp/tasks/resolveTask': {
      validateTaskIdentifier: () => ({ valid: true }),
      findTaskByIdentifier: async () => h.state.tasks.find((t) => t.id === 11),
      TaskIdentifierAmbiguityError: class extends Error {},
    },
    '@/lib/mcp/idempotency/idempotencyStore': {
      normalizeIdempotencyKey: () => null,
      withIdempotency: async (_op, _user, _key, _body, fn) => fn(),
      IdempotencyInProgressError: class extends Error {},
    },
    '@/utils/controllers/pages/htmlToMarkdown': { htmlToMarkdown: (html) => html },
    ai: { tool: (value) => value },
    '@/lib/ai/tools/execution': { withToolErrors: (fn) => fn },
    '@/lib/ai/tools/helpers': { sanitizeForJson: (value) => value, getAccessibleProjectIds: async () => [1, 2, 3] },
  };
  // Use a real human/agent membership for the MCP board predicate.
  for (const board of h.state.projects.slice(0, 2)) board.members.push({ userId: 3, agentId: 'credential-agent', status: 'Accepted', agent: { userId: 3, revokedAt: null } });
  return {
    ...h, effects, flagCalls,
    async call(boundary, operation, query = 'id=page', input = {}) {
      if (boundary === 'REST') {
        const suffix = ['list', 'search'].includes(operation) ? operation : operation === 'get' || operation === 'update' ? '[publicId]' : `[publicId]/${operation}`;
        return h.request(suffix, operation === 'update' ? 'PATCH' : ['restore', 'archive'].includes(operation) ? 'POST' : 'GET', { content: 'updated', version_id: 1 }, query);
      }
      if (boundary === 'MCP') {
        const route = load(`src/lib/mcp/operations/pages/${operation}/operation.ts`, mocks);
        const response = await (route.GET ?? route.POST)({ nextUrl: new URL(`https://fixture.invalid/?${query}`), headers: new Headers(), json: async () => ({ id: 'page', content: 'updated', version_id: 1 }) });
        return { status: response.status, body: await response.json() };
      }
      const [file, factory, name] = aiOperations[operation];
      const result = await load(`src/lib/ai/tools/${file}.ts`, mocks)[factory]({ user: { id: 3 }, sendStatus() {} })[name].execute({ id: 'page', content: 'updated', action: operation, version_id: 1, ...input });
      return { status: result.success ? 200 : 404, body: result };
    },
  };
}

for (const boundary of ['REST', 'MCP', 'AI']) {
  for (const operation of ['get', 'update', 'versions', 'restore', 'archive']) {
    test(`${boundary} ${operation}: flag-off standalone refused / legacy and flag-on standalone still work`, async () => {
      for (const [enabled, taskId, expected] of [[false, null, 404], [false, 10, 200], [true, null, 200]]) {
        const h = fixture(enabled);
        h.state.pages[0].taskId = taskId;
        const response = await h.call(boundary, operation);
        assert.equal(response.status, expected, `${enabled}/${taskId}: ${JSON.stringify(response.body)}`);
        const effectCount = operation === 'get' ? 0 : expected === 200 ? 1 : 0;
        assert.equal(h.effects.length, effectCount, 'denied reads never reach mutations or history');
        if (expected === 404) assert.doesNotMatch(JSON.stringify(response.body), /Page title|body|SECRET/);
        if (boundary !== 'REST') assert.equal(h.flagCalls.length, 1);
      }
    });
  }
  test(`${boundary} ticket list: flag-off secondary link refused / legacy and flag-on links still work`, async () => {
    for (const enabled of [false, true]) {
      const h = fixture(enabled);
      const response = await h.call(boundary, 'list', 'task_id=11', { task_id: 11 });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.pages.map((p) => p.publicId).sort(), enabled ? ['old-writer-page', 'page'] : ['old-writer-page']);
    }
  });
  test(`${boundary} search: flag-off standalone refused / legacy and flag-on standalone still work`, async () => {
    for (const enabled of [false, true]) {
      const h = fixture(enabled);
      h.state.pages.push({ ...h.state.pages[0], id: 99, publicId: 'standalone', taskId: null });
      const response = await h.call(boundary, 'search', 'q=body', { query: 'body' });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.pages.map((p) => p.publicId).sort(), enabled ? ['page', 'standalone'] : ['page']);
    }
  });
  test(`${boundary} get: flag-off linkedTasks contains only legacy ticket / flag-on retains both`, async () => {
    for (const enabled of [false, true]) {
      const h = fixture(enabled);
      const response = await h.call(boundary, 'get');
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.page.linkedTasks.map((t) => t.id).sort(), enabled ? [10, 11] : [10]);
    }
  });
}
for (const boundary of ['MCP', 'AI']) {
  test(`${boundary} board list: flag-off standalone excluded / legacy and flag-on standalone still work`, async () => {
    for (const enabled of [false, true]) {
      const h = fixture(enabled);
      const response = await h.call(boundary, 'list', 'project_id=1', { project_id: 1 });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.pages.map((p) => p.publicId).sort(), enabled ? ['old-writer-page', 'page', 'visible-child'] : ['old-writer-page', 'page']);
      assert.deepEqual(response.body.pages.find((p) => p.publicId === 'page').linkedTasks.map((t) => t.id).sort(), enabled ? [10, 11] : [10]);
    }
  });
}

for (const query of ['all', 'Page']) {
  test(`mentions ${query}: flag-off standalone excluded / legacy and flag-on standalone still work`, async () => {
    for (const enabled of [false, true]) {
      const h = fixture(enabled);
      h.state.tasks[0].projectId = 1;
      h.state.pages.find((p) => p.id === 22).title = 'Page standalone';
      h.prisma.task.findMany = async () => [];
      h.prisma.user = { findFirst: async () => ({ id: 332, displayName: 'HyperAI' }) };
      const mentions = load('src/utils/controllers/tasks/taskSearchByParam.ts', {
        '@/lib/prisma': { default: h.prisma },
        '@/app/api/ai/_lib/planGate': { haiku55ModelEnabled: async () => false },
        '@/lib/flags': { isFeatureEnabled: async (key, userId) => { assert.equal(userId, 3); return key === flag ? enabled : true; } },
        '@/lib/aiModelOptions': { aiImageModelDefinitions: [], aiModelDefinitions: [] },
        '@/utils/controllers/agents/boardMembers': { getBoardAgentMembers: async () => [] },
        '../search/document': { turbopufferFetchMentionTasks: async () => [] },
      }).default;
      const response = await mentions(query, 3, 1);
      assert.equal(response.status, 200);
      const rows = response.json.filter((p) => p.type === 'page');
      assert.deepEqual(rows.map((p) => p.id).sort(), enabled ? (query === 'all' ? ['old-writer-page', 'page', 'visible-child'] : ['page', 'visible-child']) : (query === 'all' ? ['old-writer-page', 'page'] : ['page']));
      assert.equal(response.json.find((p) => p.type === 'pageHeading').count, rows.length);
    }
  });
}


test('flag-off metadata never substitutes a visible secondary ticket for an inaccessible legacy ticket', async () => {
  for (const enabled of [false, true]) {
    const h = harness({ userId: 1, flag: enabled });
    const result = await h.request('[publicId]');
    assert.equal(result.status, 200);
    assert.equal(result.body.page.task?.id ?? null, enabled ? 11 : null);
    assert.equal(result.body.page.taskId, null);
    assert.deepEqual(result.body.page.linkedTasks.map((task) => task.id), enabled ? [11] : []);
    assert.doesNotMatch(JSON.stringify(result.body), /SECRET|987/);
  }
});

for (const boundary of ['REST', 'MCP', 'AI']) {
  test(`${boundary} get: removed or hidden origin refused as navigation / active visible secondary link still works`, async () => {
    for (const enabled of [false, true]) {
      const h = fixture(enabled);
      h.state.links[0].removedAt = new Date();
      const response = await h.call(boundary, 'get');
      assert.equal(response.status, 200);
      assert.equal(response.body.page.task.id, enabled ? 11 : 10);
      assert.equal(response.body.page.taskId, 10);
      h.state.projects[1].members = [];
      const filtered = await h.call(boundary, 'get');
      assert.equal(filtered.status, 200);
      assert.equal(filtered.body.page.task?.id ?? null, enabled ? 11 : null);
      assert.equal(filtered.body.page.taskId, null);
      assert.doesNotMatch(JSON.stringify(filtered.body), /SECRET|987/);
    }
  });
}

test('AI history: removed or inaccessible origin does not block page-board access / inaccessible page board remains refused', async () => {
  const h = fixture(true);
  h.state.links.forEach((link) => { link.removedAt = new Date(); });
  h.state.projects[1].members = [];
  assert.equal((await h.call('AI', 'versions')).status, 200);
  h.state.projects[0].members = [];
  assert.equal((await h.call('AI', 'versions')).status, 404);
  assert.deepEqual(h.effects, ['listPageVersions']);
});
