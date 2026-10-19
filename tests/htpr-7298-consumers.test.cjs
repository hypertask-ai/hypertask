const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const servicePath = '@/utils/controllers/pages/pageService';
const helperPath = '@/lib/mcp/operations/pages/helpers';
const nextServer = {
  NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) },
};

function load(file, stubs = {}) {
  stubs = { '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} }, ...stubs };
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require(id) {
      assert.ok(Object.hasOwn(stubs, id), `Unexpected import: ${id}`);
      return stubs[id];
    },
    URLSearchParams, Date, console,
    process: { env: {} },
  }, { filename });
  return loaded.exports;
}

const fieldError = load('src/lib/mcp/fieldError.ts');
const visibleTask = { id: 202, projectId: 2, title: 'Visible ticket', ticketNumber: 'OPEN-202', uniqueIndex: 202, status: 'Normal' };
const hiddenTask = { id: 909, projectId: 9, title: 'SECRET-TICKET-TITLE', ticketNumber: 'SECRET-909', uniqueIndex: 909, status: 'Normal' };
const deletedTask = { ...hiddenTask, id: 808, projectId: 2, title: 'DELETED-TICKET-TITLE', ticketNumber: 'DELETED-808', status: 'Deleted' };
const child = { id: 11, publicId: 'visible-child', title: 'Visible child' };

function harness({ boards = [1, 2], task = hiddenTask, agentId = 'credential-agent', role = 'write', boundary = 'MCP' } = {}) {
  const reads = [];
  const writes = [];
  const checks = [];
  const userId = 7;
  const viewerAgentId = boundary === 'MCP' ? agentId : null;
  const rawPage = {
    id: 10, publicId: 'page-public', title: 'Board page', version: 3,
    projectId: 1, taskId: task?.id ?? null, task,
    contentHtml: '<p>Page content</p>', contentText: 'Page content',
    updatedAt: new Date('2026-10-18T00:00:00Z'), archived: false,
    links: [hiddenTask, visibleTask, deletedTask].map((task) => ({ task })),
  };
  const visible = (task) => task && task.status !== 'Deleted' && boards.includes(task.projectId);
  const safePage = () => {
    const { links, ...page } = rawPage;
    return {
      ...page,
      task: visible(task) ? task : null,
      taskId: visible(task) ? task.id : null,
      linkedTasks: links.map((link) => link.task).filter(visible),
      subPages: [child],
    };
  };
  function read(name, args) {
    assert.equal(args.userId, userId, `${name} receives the viewer user`);
    assert.equal(args.agentId, viewerAgentId, `${name} receives the credential agent, not AI attribution`);
    reads.push({ name, args });
  }
  const service = {
    async getPage(args) { read('getPage', args); return safePage(); },
    async listPages(args) {
      read('listPages', args);
      return boards.includes(rawPage.projectId) ? [safePage()] : [];
    },
    async searchPages(args) {
      read('searchPages', args);
      return args.projectIds.includes(rawPage.projectId) && boards.includes(rawPage.projectId) ? [safePage()] : [];
    },
    async listPageVersions(args) {
      reads.push({ name: 'listPageVersions', args });
      return [{ id: 5, version: 1, title: 'Saved page', taskId: hiddenTask.id }];
    },
    PageConflictError: class PageConflictError extends Error {},
  };
  for (const name of ['createPage', 'updatePage', 'restorePageVersion', 'archivePage']) {
    service[name] = async (args) => { writes.push({ name, args }); return rawPage; };
  }
  const access = {
    async validateProjectAccess(projectId, actualUserId, actualAgentId) {
      assert.equal(actualUserId, userId);
      assert.equal(actualAgentId ?? null, viewerAgentId);
      checks.push(projectId);
      return { error: boards.includes(projectId) ? null : { message: 'Page not found' } };
    },
  };
  const helpers = load('src/lib/mcp/operations/pages/helpers.ts', {
    '@/lib/mcp/fieldError': fieldError,
    '@/lib/mcp/tasks/services': access,
  });
  const scopes = load('src/lib/mcp/agents/scopes.ts', {
    '@/lib/prisma': { default: { agent: { findUnique: async () => ({ permissions: { role } }) } }, __esModule: true },
    'next/server': nextServer,
  });
  const taskResolver = {
    validateTaskIdentifier: (input) => input.task_id || input.ticket_number || input.unique_index
      ? { valid: true }
      : { valid: false, code: 'missing_field', field: 'task_id', error: 'Task required' },
    findTaskByIdentifier: async () => visibleTask,
    TaskIdentifierAmbiguityError: class TaskIdentifierAmbiguityError extends Error {},
  };
  const stubs = {
    'next/server': nextServer,
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (handler) => handler },
    '@/lib/mcp/auth': { validateMcpAuth: async () => ({ user: { id: userId }, agentId }), checkMcpRateLimit: async () => null },
    '@/lib/mcp/agents/scopes': scopes,
    '@/lib/mcp/fieldError': fieldError,
    '@/utils/controllers/pages/standalonePagesEnabled': { standalonePagesEnabled: async () => true },
    [servicePath]: service,
    [helperPath]: helpers,
    '@/app/api/mcp/pages/_lib/routeUtils': helpers,
    '@/lib/mcp/tasks/services': access,
    '@/lib/mcp/tasks/resolveTask': taskResolver,
    '@/lib/mcp/idempotency/idempotencyStore': {
      normalizeIdempotencyKey: () => null,
      withIdempotency: async (_operation, _userId, _key, _body, fn) => fn(),
      IdempotencyInProgressError: class IdempotencyInProgressError extends Error {},
    },
    '@/lib/prisma': { default: {
      project: { findMany: async ({ where }) => {
        assert.equal(where.status, 'Normal');
        assert.equal(where.viewerUserId, userId);
        assert.equal(where.viewerAgentId, viewerAgentId);
        return boards.map((id) => ({ id }));
      } },
      task: { findUnique: async () => visibleTask },
    }, __esModule: true },
    '@/utils/controllers/projects/getAllIncludes': {
      getProjectWhere: (viewerUserId, viewerAgentId) => ({ viewerUserId, viewerAgentId }),
    },
    '@/utils/controllers/pages/htmlToMarkdown': load('src/utils/controllers/pages/htmlToMarkdown.ts', { turndown: require('turndown') }),
    '@/utils/controllers/pages/htmlCanvas': { decodeHtmlCanvas: () => null },
    ai: { tool: (definition) => definition },
    zod: require('zod'),
    '@/lib/ai/tools/execution': { withToolErrors: (fn) => fn },
    '@/lib/ai/tools/helpers': {
      sanitizeForJson: (value) => JSON.parse(JSON.stringify(value)),
      getAccessibleProjectIds: async () => boards,
    },
  };
  return {
    reads, writes, checks, rawPage,
    async mcp(operation, body = { id: 10, title: 'Updated', content: 'Updated', version_id: 5 }, query = 'id=10') {
      const route = load(`src/lib/mcp/operations/pages/${operation}/operation.ts`, stubs);
      return (route.GET ?? route.POST)({
        nextUrl: new URL(`https://example.invalid/?${query}`),
        json: async () => body,
        headers: new Headers(),
      });
    },
    async ai(file, factory, name, input = {}) {
      const tools = load(`src/lib/ai/tools/${file}.ts`, stubs)[factory]({
        user: { id: userId }, sendStatus() {}, actingAgentId: 'native-attribution',
      });
      return tools[name].execute({ id: 10, content: 'Updated', version_id: 5, ...input });
    },
    aiSchema(file, factory, name) {
      return load(`src/lib/ai/tools/${file}.ts`, stubs)[factory]({ user: { id: userId }, sendStatus() {} })[name].inputSchema;
    },
  };
}

const aiOperations = [
  ['getPage', 'createGetPageTool', 'hypertask_get_page', {}],
  ['updatePage', 'createUpdatePageTool', 'hypertask_update_page', {}],
  ...['versions', 'restore', 'archive'].map((action) => ['pageHistory', 'createPageHistoryTool', 'hypertask_page_history', { action }]),
];

for (const operation of ['get', 'update', 'versions', 'restore', 'archive']) {
  test(`MCP ${operation}: task-board-only denied next to page-board allowed`, async () => {
    for (const [boards, expected] of [[[9], 404], [[1], 200]]) {
      const h = harness({ boards });
      const result = await h.mcp(operation);
      assert.equal(result.status, expected);
      assert.deepEqual(h.checks, [1]);
      assert.equal(h.writes.length, expected === 200 && ['update', 'restore', 'archive'].includes(operation) ? 1 : 0);
    }
  });
  test(`MCP ${operation}: an existing taskless page remains usable`, async () => {
    const h = harness({ task: null });
    assert.equal((await h.mcp(operation)).status, 200);
    assert.deepEqual(h.checks, [1]);
  });
}

for (const [file, factory, name, input] of aiOperations) {
  test(`AI ${name} ${input.action ?? ''}: task-board-only denied next to page-board allowed`, async () => {
    for (const [boards, expected] of [[[9], false], [[1], true]]) {
      const h = harness({ boards, boundary: 'AI' });
      const result = await h.ai(file, factory, name, input);
      assert.equal(result.success, expected);
      assert.deepEqual(h.checks, [1]);
      if (!expected) assert.equal(h.writes.length, 0);
    }
  });
  test(`AI ${name} ${input.action ?? ''}: an existing taskless page remains usable`, async () => {
    const h = harness({ task: null, boundary: 'AI' });
    assert.equal((await h.ai(file, factory, name, input)).success, true);
    assert.deepEqual(h.checks, [1]);
    for (const { args } of h.writes) assert.equal(args.agentId, 'native-attribution');
  });
}

for (const boundary of ['MCP', 'AI']) {
  test(`${boundary} get: hidden and Deleted metadata null next to visible metadata`, async () => {
    for (const [task, boards, expected] of [
      [hiddenTask, [1, 2], null],
      [hiddenTask, [1, 2, 9], hiddenTask.id],
      [deletedTask, [1, 2, 9], null],
      [visibleTask, [1, 2], visibleTask.id],
      [null, [1, 2], null],
    ]) {
      const h = harness({ boundary, task, boards });
      const result = boundary === 'MCP'
        ? (await h.mcp('get')).body
        : await h.ai('getPage', 'createGetPageTool', 'hypertask_get_page');
      assert.equal(result.page.taskId, expected);
      assert.equal(result.page.task?.id ?? null, expected);
      assert.deepEqual(Array.from(result.page.linkedTasks, (task) => task.id), boards.includes(9) ? [909, 202] : [202]);
      assert.deepEqual(Array.from(result.page.subPages, (page) => page.id), [11]);
      assert.doesNotMatch(JSON.stringify(result), /DELETED-TICKET-TITLE|DELETED-808/);
      if (!boards.includes(9)) assert.doesNotMatch(JSON.stringify(result), /SECRET-TICKET-TITLE|SECRET-909|909/);
    }
  });
  test(`${boundary} update/history never serialize the service's raw hidden taskId`, async () => {
    const operations = boundary === 'MCP' ? ['update', 'versions', 'restore', 'archive'] : aiOperations.slice(1);
    for (const operation of operations) {
      const h = harness({ boundary });
      const result = boundary === 'MCP'
        ? (await h.mcp(operation)).body
        : await h.ai(...operation);
      assert.doesNotMatch(JSON.stringify(result), /909|SECRET-TICKET|taskId|links/);
      if (h.writes.length) assert.equal(h.rawPage.taskId, 909);
    }
  });
  test(`${boundary} ticket lists omit inaccessible pages next to visible pages`, async () => {
    for (const [boards, count] of [[[2], 0], [[1, 2], 1]]) {
      const h = harness({ boundary, boards });
      const result = boundary === 'MCP'
        ? (await h.mcp('list', undefined, 'task_id=202')).body
        : await h.ai('listPages', 'createListPagesTool', 'hypertask_list_pages', { task_id: 202 });
      assert.equal(result.pages.length, count);
      assert.equal(h.reads[0].args.taskId, 202);
      if (!count) assert.doesNotMatch(JSON.stringify(result), /Board page|page-public/);
    }
  });
  test(`${boundary} list/search preserve hidden and Deleted metadata filtering next to visible metadata`, async () => {
    for (const task of [hiddenTask, deletedTask, visibleTask]) {
      for (const boards of [[1, 2], [1, 2, 9]]) {
        const h = harness({ boundary, task, boards });
        const list = boundary === 'MCP'
          ? (await h.mcp('list', undefined, 'task_id=202')).body
          : await h.ai('listPages', 'createListPagesTool', 'hypertask_list_pages', { task_id: 202 });
        const search = boundary === 'MCP'
          ? (await h.mcp('search', undefined, 'q=Page')).body
          : await h.ai('searchPages', 'createSearchPagesTool', 'hypertask_search_pages', { query: 'Page' });
        const expected = task.status !== 'Deleted' && boards.includes(task.projectId) ? task.id : null;
        for (const result of [list, search]) {
          assert.equal(result.pages.length, 1);
          assert.equal(result.pages[0].taskId, expected);
          assert.doesNotMatch(JSON.stringify(result), /DELETED-TICKET-TITLE|DELETED-808|808/);
          if (!boards.includes(9)) assert.doesNotMatch(JSON.stringify(result), /SECRET-TICKET-TITLE|SECRET-909|909/);
        }
      }
    }
  });
  test(`${boundary} get keeps public-ID identification and viewer filtering`, async () => {
    const h = harness({ boundary });
    const result = boundary === 'MCP'
      ? (await h.mcp('get', undefined, 'page_id=page-public')).body
      : await h.ai('getPage', 'createGetPageTool', 'hypertask_get_page', { id: 'page-public' });
    assert.equal(result.page.publicId, 'page-public');
    assert.equal(h.reads[0].args.publicId, 'page-public');
    assert.equal(result.page.taskId, null);
  });
  test(`${boundary} board list and search pass viewer context and retain taskless pages`, async () => {
    const h = harness({ boundary, task: null });
    const list = boundary === 'MCP'
      ? (await h.mcp('list', undefined, 'project_id=1')).body
      : await h.ai('listPages', 'createListPagesTool', 'hypertask_list_pages', { project_id: 1 });
    assert.equal(list.pages.length, 1);
    const search = boundary === 'MCP'
      ? (await h.mcp('search', undefined, 'q=Page')).body
      : await h.ai('searchPages', 'createSearchPagesTool', 'hypertask_search_pages', { query: 'Page' });
    assert.equal(search.pages.length, 1);
    assert.equal(search.pages[0].taskId, null);
    assert.ok(search.pages[0].snippet.includes('Page content'));
    assert.doesNotMatch(JSON.stringify(search), /SECRET-TICKET|909|808/);
    assert.deepEqual(Array.from(h.reads.at(-1).args.projectIds), [1, 2]);
  });
}

for (const operation of ['create', 'update', 'restore', 'archive']) {
  test(`MCP ${operation}: read-only credential denied next to successful write credential`, async () => {
    for (const [role, expected] of [['read', 403], ['write', 200]]) {
      const h = harness({ role });
      const result = await h.mcp(operation, { id: 10, task_id: 202, content: 'Updated', version_id: 5 });
      assert.equal(result.status, expected);
      assert.equal(h.writes.length, role === 'write' ? 1 : 0);
      if (role === 'read') assert.equal(h.reads.length, 0);
    }
  });
}

test('MCP and AI creation remain task-origin only', async () => {
  const h = harness();
  assert.equal((await h.mcp('create', { project_id: 1, content: 'Standalone' })).status, 400);
  assert.equal(h.writes.length, 0);
  const schema = h.aiSchema('createPage', 'createCreatePageTool', 'hypertask_create_page');
  assert.equal(schema.safeParse({ project_id: 1, content: 'Standalone' }).success, false);
  assert.equal(schema.safeParse({ task_id: 202, content: 'Ticket page' }).success, true);
});

for (const boundary of ['MCP', 'AI']) {
  test(`${boundary} creation refuses invalid parent IDs / forwards valid parent_page_id unchanged`, async () => {
    const h = harness({ boundary });
    if (boundary === 'MCP') {
      assert.equal((await h.mcp('create', { task_id: 202, parent_page_id: 0, content: '' })).status, 400);
      assert.equal(h.writes.length, 0);
      assert.equal((await h.mcp('create', { task_id: 202, parent_page_id: 303, content: '' })).status, 200);
    } else {
      const schema = h.aiSchema('createPage', 'createCreatePageTool', 'hypertask_create_page');
      assert.equal(schema.safeParse({ task_id: 202, parent_page_id: 0, content: '' }).success, false);
      assert.equal(schema.safeParse({ task_id: 202, parent_page_id: 303, content: '' }).success, true);
      assert.equal((await h.ai('createPage', 'createCreatePageTool', 'hypertask_create_page', { task_id: 202, parent_page_id: 303 })).success, true);
    }
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].name, 'createPage');
    assert.equal(h.writes[0].args.parentPageId, 303);
    assert.equal(h.writes[0].args.taskId, 202);
  });

  test(`${boundary} content output is absent when denied / retains the produced HTML structure and Markdown when allowed`, async () => {
    for (const boards of [[2], [1, 2]]) {
      const h = harness({ boundary, boards });
      const result = boundary === 'MCP'
        ? (await h.mcp('get', undefined, 'id=10&format=html')).body
        : await h.ai('getPage', 'createGetPageTool', 'hypertask_get_page', { format: 'html' });
      if (!boards.includes(1)) {
        assert.equal(result.page, undefined);
      } else {
        const document = require('node-html-parser').parse(result.page.content);
        assert.equal(result.page.content_type, 'html');
        assert.equal(document.childNodes.length, 1);
        assert.equal(document.firstChild.tagName, 'P');
        assert.equal(document.firstChild.textContent, 'Page content');
        assert.equal(document.firstChild.childNodes.length, 1);
        const markdown = boundary === 'MCP'
          ? (await h.mcp('get')).body
          : await h.ai('getPage', 'createGetPageTool', 'hypertask_get_page');
        assert.equal(markdown.page.content_type, 'markdown');
        assert.equal(markdown.page.content, 'Page content');
      }
    }
  });
}
