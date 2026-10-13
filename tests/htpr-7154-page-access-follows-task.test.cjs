// HTPR-7154: stale Page.projectId must never grant access after its task moves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function loadModule(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: (id) => {
      assert.ok(id in stubs, `Unexpected import: ${id}`);
      return stubs[id];
    },
    console: { log() {}, error() {} }, URLSearchParams, Date, process,
  }, { filename });
  return loaded.exports;
}

const PAGE = {
  id: 10, publicId: 'moved-page', title: 'Private page', contentHtml: '<p>Secret</p>',
  contentText: 'Secret', projectId: 1, taskId: 20, version: 2, archived: false,
  task: { id: 20, projectId: 2, title: 'Moved task', ticketNumber: 'B-20', uniqueIndex: 20 },
  subPages: [],
};

function serviceHarness() {
  let page = structuredClone(PAGE);
  const writes = [];
  const queries = [];
  const tx = {
    page: {
      findUnique: async ({ where, include }) => {
        queries.push({ where, include });
        assert.ok(include?.task.select.projectId || !include, 'page lookup selects current task board');
        return { ...page };
      },
      findMany: async (query) => {
        queries.push(query);
        const board = query.where.task?.projectId;
        const projectId = board ?? query.where.projectId;
        const currentBoard = board === undefined ? page.projectId : page.task.projectId;
        const matches = projectId === undefined || (typeof projectId === 'number'
          ? projectId === currentBoard : projectId.in.includes(currentBoard));
        return matches && !page.archived ? [{ ...page }] : [];
      },
      updateMany: async ({ data }) => {
        writes.push('update');
        page = { ...page, ...data, version: page.version + data.version.increment };
        return { count: 1 };
      },
      update: async ({ data }) => {
        writes.push('update');
        page = { ...page, ...data, version: data.version ? page.version + data.version.increment : page.version };
        return { ...page };
      },
    },
    docVersion: {
      create: async () => { writes.push('snapshot'); },
      findMany: async () => [{ id: 5, version: 1 }],
      findFirst: async () => ({ id: 5, version: 1, title: 'Old title', contentHtml: '<p>Old</p>', contentText: 'Old' }),
    },
  };
  const service = loadModule('src/utils/controllers/pages/pageService.ts', {
    '@/lib/prisma': { __esModule: true, default: { ...tx, $transaction: async (op) => op(tx) } },
    '@/utils/controllers/tasks/assertTaskAccess': { taskAccessWhere: () => ({ project: { allowed: true } }) },
    '@/utils/controllers/turbopuffer/turbopufferHelper': {
      convertToPlain: (html) => html.replace(/<[^>]*>/g, ''),
      upsertPageToTurbopuffer: async () => {}, deletePageFromTurbopuffer: async () => {},
    },
    '@/utils/helperFunctions/markdownToHtml': { markdownToHtml: (s) => `<p>${s}</p>` },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (s) => s },
    './htmlCanvas': { decodeHtmlCanvas: () => null },
  });
  return { service, writes, queries };
}

const nextServer = { NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) } };
const fieldError = loadModule('src/lib/mcp/fieldError.ts', {});

function helpers(board) {
  return loadModule('src/lib/mcp/operations/pages/helpers.ts', {
    '@/lib/mcp/fieldError': fieldError,
    '@/lib/mcp/tasks/services': { validateProjectAccess: async (projectId) => ({ error: projectId === board ? null : { message: 'Page not found' } }) },
  });
}

for (const operation of ['get', 'versions', 'update', 'archive', 'restore']) {
  for (const board of [1, 2]) {
    test(`MCP ${operation}: stale page denies board A and allows current board B (caller ${board})`, async () => {
      const h = serviceHarness();
      const route = loadModule(`src/lib/mcp/operations/pages/${operation}/operation.ts`, {
        'next/server': nextServer,
        '@/lib/mcp/auth': { validateMcpAuth: async () => ({ user: { id: 7 }, agentId: null }), checkMcpRateLimit: async () => null },
        '@/lib/mcp/agents/scopes': { requireRole: async () => null },
        '@/lib/mcp/fieldError': fieldError,
        '@/utils/controllers/pages/pageService': h.service,
        '@/lib/mcp/operations/pages/helpers': helpers(board),
        '@/utils/controllers/pages/htmlToMarkdown': { htmlToMarkdown: (s) => s },
        '@/utils/controllers/pages/htmlCanvas': { decodeHtmlCanvas: () => null },
      });
      const request = { nextUrl: new URL('https://example.invalid/?id=10'), json: async () => ({ id: 10, title: 'Updated title', version_id: 5 }) };
      const response = await (route.GET ?? route.POST)(request);
      assert.equal(response.status, board === 1 ? 404 : 200);
      const mutates = ['update', 'archive', 'restore'].includes(operation);
      assert.equal(h.writes.length, board === 2 && mutates ? 2 : 0, 'denied callers cannot snapshot or mutate');
    });
  }
}

for (const [file, factory, tool, actions] of [
  ['getPage', 'createGetPageTool', 'hypertask_get_page', [undefined]],
  ['updatePage', 'createUpdatePageTool', 'hypertask_update_page', [undefined]],
  ['pageHistory', 'createPageHistoryTool', 'hypertask_page_history', ['versions', 'archive', 'restore']],
]) {
  for (const action of actions) {
    test(`AI ${file} ${action ?? ''}: access follows current task board`, async () => {
      for (const board of [1, 2]) {
        const h = serviceHarness();
        const loaded = loadModule(`src/lib/ai/tools/${file}.ts`, {
          ai: { tool: (definition) => definition }, zod: require('zod'),
          '@/utils/controllers/pages/pageService': h.service,
          '@/lib/mcp/tasks/services': { validateProjectAccess: async (projectId) => ({ error: projectId === board ? null : { message: 'Page not found' } }) },
          '@/app/api/mcp/pages/_lib/routeUtils': helpers(board),
          '@/utils/controllers/pages/htmlToMarkdown': { htmlToMarkdown: (s) => s },
          '@/lib/ai/tools/execution': { withToolErrors: (op) => op },
          '@/lib/ai/tools/helpers': { sanitizeForJson: (value) => value },
        });
        const result = await loaded[factory]({ user: { id: 7 }, sendStatus() {}, actingAgentId: null })[tool].execute({ id: 10, content: 'Updated', action, version_id: 5 });
        assert.equal(result.success, board === 2);
        if (board === 1) assert.equal(h.writes.length, 0);
      }
    });
  }
}

for (const operation of ['listPages', 'searchPages']) {
  test(`${operation}: board filtering follows the task and preserves archived/text filters`, async () => {
    const h = serviceHarness();
    for (const board of [1, 2]) {
      const args = operation === 'listPages' ? { projectId: board, taskId: 20 } : { query: ' Secret ', projectIds: [board] };
      const pages = await h.service[operation](args);
      assert.equal(pages.length, board === 2 ? 1 : 0);
      const { where } = h.queries.at(-1);
      assert.equal(where.projectId, undefined);
      assert.equal(where.archived, false);
      if (operation === 'listPages') {
        assert.equal(where.task.projectId, board);
        assert.equal(where.taskId, 20);
      } else {
        assert.equal(where.task.projectId.in[0], board);
        assert.equal(where.OR[1].contentText.contains, 'Secret');
      }
    }
  });
}

test('moving a task synchronizes pages for its entire subtask tree', async () => {
  const tasks = [
    { id: 20, projectId: 1, userId: 7, subTasks: [{ id: 21 }] },
    { id: 21, projectId: 1, userId: 7, subTasks: [{ id: 22 }] },
    { id: 22, projectId: 1, userId: 7, subTasks: [] },
  ];
  const pages = tasks.map(({ id }) => ({ taskId: id, projectId: 1 }));
  pages.push({ taskId: 999, projectId: 1 });
  const noUpdate = { updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }), findMany: async () => [] };
  const prisma = {
    task: { findUnique: async ({ where }) => structuredClone(tasks.find((t) => t.id === where.id)), findFirst: async () => null },
    project: { findUnique: async () => ({ teamId: 'team', uniqueIdentifier: 'B' }), findFirst: async () => ({ id: 2 }) },
    section: { findUnique: async () => ({ id: 3, projectId: 2, section_title: 'Todo' }) },
    page: { updateMany: async ({ where, data }) => { for (const page of pages) if (page.taskId === where.taskId) Object.assign(page, data); return { count: 1 }; } },
    estimate: noUpdate, priority: noUpdate, savedContent: noUpdate, notification: noUpdate,
    assignees: noUpdate, follower: noUpdate, drafts: noUpdate, reminder: noUpdate, taskLabel: noUpdate,
  };
  const { moveTaskToDifferentBoard } = loadModule('src/utils/controllers/tasks/moveToDifferentBoard.ts', {
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/utils/controllers/getMemberAndOwnerForBoard': { __esModule: true, default: async () => [7] },
    '@/utils/generateRank': { __esModule: true, default: () => 'rank' },
    './getNextUniqueTaskIndex': { getNextUniqueTaskIndex: async () => 1 },
    '@/pages/api/queues/duedateQueue': { cancelDueDateJob: async () => {}, scheduleDueDateJob: async () => {} },
    'date-fns': { subMinutes: (date) => date },
    '@/utils/controllers/tasks/single': { updateTaskSingle: async (data) => ({ status: 200, json: data }) },
    '@/lib/api/errorMessage': { toErrorMessage: (_body, fallback) => fallback },
    '@/utils/controllers/assignees/autoAssignForSection': { autoAssignForSection: async () => 'ready' },
    '@/utils/controllers/projects/getAllIncludes': { taskWriteAccessWhere: () => ({ allowed: true }) },
  });
  const result = await moveTaskToDifferentBoard({ taskId: 20, currentProjectId: 1, targetProjectId: 2, targetSectionId: 3, currentUser: { id: 7 } });
  assert.equal(result.success, true);
  assert.deepEqual(pages.map((page) => page.projectId), [2, 2, 2, 1]);
});

test('page indexing uses the current task board and selects it on upsert', async () => {
  const helper = loadModule('src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    '@/lib/prisma': { __esModule: true, default: {} },
    '@/lib/turbopuffer': { __esModule: true, default: {}, turbopufferNamespaces: {} },
    crypto: require('node:crypto'), 'node-html-parser': require('node-html-parser'),
    '@/utils/controllers/search/rankHits': {},
    '@/app/api/ai/_lib/boardMemoryContract': {},
  });
  assert.equal(helper.turbopufferPageInclude.task.select.projectId, true);
  assert.equal(helper.buildTurbopufferPageRow(PAGE).projectId, 2);
});

test('page image downloads authorize the current task board', async () => {
  const key = 'uploads/private.png';
  const access = { allowedBoard: 2 };
  let pageQuery;
  const helper = loadModule('src/utils/controllers/tasks/getAccessibleAttachmentKey.ts', {
    '@/lib/prisma': { __esModule: true, default: {
      attachment: { findMany: async () => [] }, description: { findMany: async () => [] }, comment: { findMany: async () => [] },
      page: { findMany: async (query) => { pageQuery = query; return query.where.task?.project === access ? [{ contentHtml: key }] : []; } },
    } },
    'node-html-parser': require('node-html-parser'),
    '@/lib/storage/hypertasksS3': { parseHypertasksStorageKeyFromUrl: (url) => url === key ? key : null },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => access },
    '@/utils/controllers/urls/extractUrlsFromContent': { extractUrlsFromContent: (content) => [{ urlString: content }] },
    '@/utils/controllers/pages/htmlCanvas': { decodeHtmlPayloadServer: (s) => s },
  });
  assert.equal(await helper.getAccessibleAttachmentKey(key, 7), key);
  assert.equal(pageQuery.where.task.project, access);
  assert.equal(pageQuery.where.project, undefined);
});

test('page mentions filter on the current task board', async () => {
  let pageQuery;
  const loaded = loadModule('src/utils/controllers/tasks/taskSearchByParam.ts', {
    '@/app/api/ai/_lib/planGate': { haiku55ModelEnabled: async () => false },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ({ allowed: true }) },
    '@/lib/prisma': { __esModule: true, default: {
      project: { findMany: async () => [{ id: 2 }], findFirst: async () => ({ members: [], owner: { id: 7 } }) },
      user: { findFirst: async () => ({ id: 332 }) },
      task: { findMany: async () => [] },
      page: { findMany: async (query) => { pageQuery = query; return query.where.task?.projectId === 2 ? [PAGE] : []; } },
    } },
    '@/lib/aiModelOptions': { aiModelDefinitions: [], aiImageModelDefinitions: [] },
    '@/utils/controllers/agents/boardMembers': { getBoardAgentMembers: async () => [] },
    '../search/document': { turbopufferFetchMentionTasks: async () => [] },
    '@/lib/flags': { isFeatureEnabled: async () => true, PAGE_MENTIONS_FLAG: 'pages' },
    '@/utils/helperFunctions/mentionSearch': { matchesMentionName: () => true, selectMentionAgents: () => [] },
  });
  const result = await loaded.default('', 7, 2);
  assert.equal(result.status, 200);
  assert.ok(pageQuery, 'mention lookup ran');
  assert.equal(pageQuery.where.task.projectId, 2);
  assert.equal(pageQuery.where.task.deletedAt, null);
  assert.equal(pageQuery.where.projectId, undefined);
});

test('data-only migration repairs only pages whose board differs from their task', () => {
  const sql = fs.readFileSync(path.join(root, 'src/prisma/migrations/20261012140000_htpr_7154_page_project_follows_task/migration.sql'), 'utf8');
  assert.equal(sql.trim(), 'UPDATE "Page" p SET "projectId" = t."projectId" FROM "Task" t WHERE p."taskId" = t.id AND p."projectId" <> t."projectId";');
});
