const { withStubs } = require('./helpers/stub-map.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function loadModule(file, stubs) {
  stubs = withStubs({ '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} } }, stubs);
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: (id) => {
      if (id === '@/lib/mcp/routeWrapper') return require('./helpers/mcp-route-wrapper.cjs').loadRouteWrapper(withStubs(stubs, { '@/lib/aiFeedback/automatic': { queueRestFailure: () => {} } }));
      if (id === "@/lib/planLimits") return { isPlanLimitReachedError: () => false, isPlanLimitsEnabled: async () => false, assertTaskCountTransition: async () => {}, assertTicketRoom: async () => {}, assertProjectTicketRoom: async () => {}, assertBoardRoom: async () => {} };
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
        assert.ok(include?.task.select.projectId || !include, 'page lookup selects optional ticket metadata');
        return { ...page, links: [], _count: { links: 0 } };
      },
      findMany: async (query) => {
        queries.push(query);
        const board = query.where.task?.projectId;
        const projectId = board ?? query.where.projectId;
        const currentBoard = board === undefined ? page.projectId : page.task.projectId;
        const matches = projectId === undefined || (typeof projectId === 'number'
          ? projectId === currentBoard : projectId.in.includes(currentBoard));
        return matches && !page.archived ? [{ ...page, links: [] }] : [];
      },
      updateMany: async ({ data }) => {
        writes.push('update');
        page = { ...page, ...data, version: page.version + data.version.increment };
        return { count: 1 };
      },
      update: async ({ data }) => {
        writes.push('update');
        page = { ...page, ...data, version: data.version ? page.version + data.version.increment : page.version };
        return { ...page, links: [] };
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
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({ allowed: true }) },
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
    test(`MCP ${operation}: page board A allowed and linked task board B denied (caller ${board})`, async () => {
      const h = serviceHarness();
      const route = loadModule(`src/lib/mcp/operations/pages/${operation}/operation.ts`, {
        'next/server': nextServer,
        '@/lib/mcp/auth': { validateMcpAuth: async () => ({ user: { id: 7 }, agentId: null }), checkMcpRateLimit: async () => null },
        '@/lib/mcp/agents/scopes': { requireRole: async () => null },
        '@/lib/mcp/fieldError': fieldError,
        '@/utils/controllers/pages/standalonePagesEnabled': { standalonePagesEnabled: async () => true },
        '@/utils/controllers/pages/pageService': h.service,
        '@/lib/mcp/operations/pages/helpers': helpers(board),
        '@/utils/controllers/pages/htmlToMarkdown': { htmlToMarkdown: (s) => s },
        '@/utils/controllers/pages/htmlCanvas': { decodeHtmlCanvas: () => null },
      });
      const request = { headers: new Headers({ Authorization: `Bearer ${require('jsonwebtoken').sign({ userId: 7 }, 'fixture')}` }), nextUrl: new URL('https://example.invalid/?id=10'), json: async () => ({ id: 10, title: 'Updated title', version_id: 5 }) };
      const response = await (route.GET ?? route.POST)(request);
      assert.equal(response.status, board === 1 ? 200 : 404);
      const mutates = ['update', 'archive', 'restore'].includes(operation);
      assert.equal(h.writes.length, board === 1 && mutates ? 2 : 0, 'denied callers cannot snapshot or mutate');
    });
  }
}

for (const [file, factory, tool, actions] of [
  ['getPage', 'createGetPageTool', 'hypertask_get_page', [undefined]],
  ['updatePage', 'createUpdatePageTool', 'hypertask_update_page', [undefined]],
  ['pageHistory', 'createPageHistoryTool', 'hypertask_page_history', ['versions', 'archive', 'restore']],
]) {
  for (const action of actions) {
    test(`AI ${file} ${action ?? ''}: access follows owning page board`, async () => {
      for (const board of [1, 2]) {
        const h = serviceHarness();
        const loaded = loadModule(`src/lib/ai/tools/${file}.ts`, {
          ai: { tool: (definition) => definition }, zod: require('zod'),
          '@/utils/controllers/pages/standalonePagesEnabled': { standalonePagesEnabled: async () => true },
          '@/utils/controllers/pages/pageService': h.service,
          '@/lib/mcp/tasks/services': { validateProjectAccess: async (projectId) => ({ error: projectId === board ? null : { message: 'Page not found' } }) },
          '@/app/api/mcp/pages/_lib/routeUtils': helpers(board),
          '@/utils/controllers/pages/htmlToMarkdown': { htmlToMarkdown: (s) => s },
          '@/lib/ai/tools/execution': { withToolErrors: (op) => op },
          '@/lib/ai/tools/helpers': { sanitizeForJson: (value) => value },
        });
        const result = await loaded[factory]({ user: { id: 7 }, sendStatus() {}, actingAgentId: null })[tool].execute({ id: 10, content: 'Updated', action, version_id: 5 });
        assert.equal(result.success, board === 1);
        if (board === 2) assert.equal(h.writes.length, 0);
      }
    });
  }
}

for (const operation of ['listPages', 'searchPages']) {
  test(`${operation}: board filtering follows page ownership and preserves archived/text filters`, async () => {
    const h = serviceHarness();
    for (const board of [1, 2]) {
      const args = operation === 'listPages' ? { projectId: board, taskId: 20 } : { query: ' Secret ', projectIds: [board] };
      const pages = await h.service[operation](args);
      assert.equal(pages.length, board === 1 ? 1 : 0);
      const { where } = h.queries.at(-1);
      assert.equal(where.task, undefined);
      assert.equal(where.archived, false);
      if (operation === 'listPages') {
        assert.equal(where.projectId, board);
        assert.equal(where.OR[0].links.some.taskId, 20);
        assert.equal(where.OR[1].taskId, 20);
      } else {
        assert.equal(where.projectId.in[0], board);
        assert.equal(where.OR[1].contentText.contains, 'Secret');
      }
    }
  });
}

test('moving a task synchronizes pages for its entire subtask tree inside each task transaction', async () => {
  const tasks = [
    { id: 20, projectId: 1, userId: 7, subTasks: [{ id: 21 }] },
    { id: 21, projectId: 1, userId: 7, subTasks: [{ id: 22 }] },
    { id: 22, projectId: 1, userId: 7, subTasks: [] },
  ];
  const pages = tasks.map(({ id }) => ({ id, taskId: id, projectId: 1, parentPageId: null, links: [{ taskId: id, removedAt: null }] }));
  pages.push({ id: 999, taskId: 999, projectId: 1, parentPageId: null, links: [{ taskId: 999, removedAt: null }] });
  const synced = [];
  const noUpdate = { updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }), findMany: async () => [] };
  const tx = {
    $queryRaw: async () => [],
    page: {
      findMany: async ({ where, include }) => pages.filter((page) => {
        if (!where.OR) return where.id.in.includes(page.id);
        return where.OR.some((part) => {
          if (part.taskId) return typeof part.taskId === 'number' ? page.taskId === part.taskId : part.taskId.in.includes(page.taskId);
          if (part.links) return page.links.some((link) => typeof part.links.some.taskId === 'number' ? link.taskId === part.links.some.taskId : part.links.some.taskId.in.includes(link.taskId));
          if (part.id) return part.id.in.includes(page.id);
          return part.parentPageId.in.includes(page.parentPageId);
        });
      }).map((page) => ({ ...page, ...(include?.parentPage ? { parentPage: pages.find((parent) => parent.id === page.parentPageId) ?? null } : {}) })),
      updateMany: async ({ where, data }) => {
        for (const page of pages) {
          const idMatches = where.id?.in ? where.id.in.includes(page.id) : !where.id?.notIn?.includes(page.id);
          const parentMatches = where.parentPageId?.in ? where.parentPageId.in.includes(page.parentPageId) : !where.parentPageId?.notIn?.includes(page.parentPageId);
          if (idMatches && parentMatches) Object.assign(page, data);
        }
        return { count: 1 };
      },
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(tx),
    task: { findUnique: async ({ where }) => structuredClone(tasks.find((t) => t.id === where.id)), findFirst: async () => null },
    project: { findUnique: async () => ({ teamId: 'team', uniqueIdentifier: 'B' }), findFirst: async () => ({ id: 2 }) },
    section: { findUnique: async () => ({ id: 3, projectId: 2, section_title: 'Todo' }) },
    estimate: noUpdate, priority: noUpdate, savedContent: noUpdate, notification: noUpdate,
    assignees: noUpdate, follower: noUpdate, drafts: noUpdate, reminder: noUpdate, taskLabel: noUpdate,
  };
  const { moveTaskToDifferentBoard } = loadModule('src/utils/controllers/tasks/moveToDifferentBoard.ts', {
    '@prisma/client': require('@prisma/client'),
    '../turbopuffer/turbopufferHelper': { upsertPageToTurbopuffer: async () => {} },
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/utils/controllers/getMemberAndOwnerForBoard': { __esModule: true, default: async () => [7] },
    '@/utils/generateRank': { __esModule: true, default: () => 'rank' },
    './getNextUniqueTaskIndex': { getNextUniqueTaskIndex: async () => 1 },
    '@/pages/api/queues/duedateQueue': { cancelDueDateJob: async () => {}, scheduleDueDateJob: async () => {} },
    'date-fns': { subMinutes: (date) => date },
    '@/utils/controllers/tasks/single': { updateTaskSingle: async (data, _user, _agent, options) => {
      const before = tasks.find((task) => task.id === data.id);
      await options.onProjectChangedInTx(tx, before, { ...before, ...data });
      synced.push(data.id);
      return { status: 200, json: data };
    } },
    '@/lib/api/errorMessage': { toErrorMessage: (_body, fallback) => fallback },
    '@/utils/controllers/assignees/autoAssignForSection': { autoAssignForSection: async () => 'ready' },
    '@/utils/controllers/projects/getAllIncludes': { taskWriteAccessWhere: () => ({ allowed: true }) },
  });
  const result = await moveTaskToDifferentBoard({ taskId: 20, currentProjectId: 1, targetProjectId: 2, targetSectionId: 3, currentUser: { id: 7 } });
  assert.equal(result.success, true);
  assert.deepEqual(synced, [20, 21, 22]);
  assert.deepEqual(pages.map((page) => page.projectId), [2, 2, 2, 1]);
});

test('page indexing uses the owning page board and selects it on upsert', async () => {
  const helper = loadModule('src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    '@/app/api/ai/_lib/aiUsage': { logAiUsage: async () => {} },
    '@/lib/prisma': { __esModule: true, default: {} },
    '@/lib/turbopuffer': { __esModule: true, default: {}, turbopufferNamespaces: {} },
    crypto: require('node:crypto'), 'node-html-parser': require('node-html-parser'),
    '@/utils/controllers/search/rankHits': {},
    '@/app/api/ai/_lib/boardMemoryContract': {},
    '@/lib/ai/teamAiFunding': require('./helpers/team-ai-funding-stub.cjs'),
    './embedRowsForWrite': {},
  });
  assert.equal(helper.turbopufferPageInclude.project.select.title, true);
  assert.equal(helper.buildTurbopufferPageRow(PAGE).projectId, 1);
});

test('page image downloads authorize the owning page board', async () => {
  const key = 'uploads/private.png';
  const access = { allowedBoard: 2 };
  let pageQuery;
  const helper = loadModule('src/utils/controllers/tasks/getAccessibleAttachmentKey.ts', {
    '@/lib/prisma': { __esModule: true, default: {
      attachment: { findMany: async () => [] }, description: { findMany: async () => [] }, comment: { findMany: async () => [] },
      page: { findMany: async (query) => { pageQuery = query; return query.where.project === access ? [{ contentHtml: key }] : []; } },
    } },
    'node-html-parser': require('node-html-parser'),
    '@/lib/storage/hypertasksS3': { parseHypertasksStorageKeyFromUrl: (url) => url === key ? key : null },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => access },
    '@/utils/controllers/urls/extractUrlsFromContent': { extractUrlsFromContent: (content) => [{ urlString: content }] },
    '@/utils/controllers/pages/htmlCanvas': { decodeHtmlPayloadServer: (s) => s },
  });
  assert.equal(await helper.getAccessibleAttachmentKey(key, 7), key);
  assert.equal(pageQuery.where.project, access);
  assert.equal(pageQuery.where.task, undefined);
});

test('page mentions filter on the owning page board without ticket metadata', async () => {
  let pageQuery;
  const loaded = loadModule('src/utils/controllers/tasks/taskSearchByParam.ts', {
    '@/app/api/ai/_lib/planGate': { haiku55ModelEnabled: async () => false },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ({ allowed: true }) },
    '@/lib/prisma': { __esModule: true, default: {
      project: { findMany: async () => [{ id: 2 }], findFirst: async () => ({ members: [], owner: { id: 7 } }) },
      user: { findFirst: async () => ({ id: 332 }) },
      task: { findMany: async () => [] },
      page: { findMany: async (query) => { pageQuery = query; return query.where.projectId === 2 ? [PAGE] : []; } },
    } },
    '@/lib/aiModelOptions': { aiModelDefinitions: [], aiImageModelDefinitions: [] },
    '@/utils/controllers/agents/boardMembers': { getBoardAgentMembers: async () => [] },
    '../search/document': { turbopufferFetchMentionTasks: async () => [] },
    '@/utils/controllers/pages/standalonePagesEnabled': { standalonePagesEnabled: async () => true },
    '@/lib/flags/definitions/htpr-7859-remove-image-generation': { HTPR_7859_REMOVE_IMAGE_GENERATION_FLAG: 'htpr-7859-remove-image-generation' },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/utils/helperFunctions/mentionSearch': { matchesMentionName: () => true, selectMentionAgents: () => [] },
  });
  const result = await loaded.default('', 7, 2);
  assert.equal(result.status, 200);
  assert.ok(pageQuery, 'mention lookup ran');
  assert.equal(pageQuery.where.projectId, 2);
  assert.equal(pageQuery.where.task, undefined);
  assert.equal(pageQuery.select.task, undefined);
});

test('data-only migration repairs only pages whose board differs from their task', () => {
  const sql = fs.readFileSync(path.join(root, 'src/prisma/migrations/20261012140000_htpr_7154_page_project_follows_task/migration.sql'), 'utf8');
  assert.equal(sql.trim(), 'UPDATE "Page" p SET "projectId" = t."projectId" FROM "Task" t WHERE p."taskId" = t.id AND p."projectId" <> t."projectId";');
});
