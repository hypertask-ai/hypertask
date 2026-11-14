const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/loadModule.cjs');

const pageRow = (overrides) => ({
  id: 1, publicId: 'page-public-1', title: 'Indexed title', contentText: 'Indexed text',
  projectId: 15, project: { id: 15, title: 'Hypertask Product' }, parentPageId: null, parentPage: null,
  updatedAt: new Date('2026-11-10T00:00:00.000Z'), task: null, links: [], ...overrides,
});

function loadPageService({ indexRows = [], projects = [{ id: 15 }], findMany, flagOn = true } = {}) {
  const calls = { index: [], findMany: [], projects: [] };
  const service = loadModule('src/utils/controllers/pages/pageService.ts', {
    '@/lib/prisma': { default: {
      page: { findMany: async (args) => {
        calls.findMany.push(args);
        return findMany ? findMany(args, calls.findMany.length) : [];
      } },
      project: { findMany: async (args) => {
        calls.projects.push(args);
        return projects;
      } },
    } },
    '@/utils/controllers/projects/getAllIncludes': {
      getProjectWhere: (userId, agentId) => ({ OR: [{ ownerId: userId }, { members: { some: { userId } } }], agentId }),
    },
    '@/utils/controllers/turbopuffer/pageSearch': {
      smartPageSearchEnabled: async () => flagOn,
      searchPagesInTurbopuffer: async (args) => {
        calls.index.push(args);
        return indexRows;
      },
    },
    '@/utils/controllers/turbopuffer/turbopufferHelper': {
      convertToPlain: (value) => value, deletePageFromTurbopuffer: async () => {}, upsertPageToTurbopuffer: async () => {},
    },
    '@/utils/helperFunctions/markdownToHtml': { markdownToHtml: (value) => value },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (value) => value },
  });
  return { service, calls };
}

const listArgs = { projectId: 15, userId: 985, standalonePagesEnabled: true, agentId: null, archived: false };

test('the pages screen search returns literal matches and then the pages the index found', async () => {
  const { service, calls } = loadPageService({
    indexRows: [{ id: '31' }, { id: '17' }, { id: 'nope' }, { id: '31' }],
    findMany: (args) => (args.where.id ? [pageRow({ id: 17, title: 'Second' }), pageRow({ id: 31, title: 'First' })] : [pageRow({ id: 9, title: 'Literal' })]),
  });
  const pages = await service.listPages({ ...listArgs, query: '  different words  ' });
  assert.deepEqual(calls.index, [{ searchQuery: 'different words', projectIds: [15], userId: 985 }]);
  assert.equal(calls.findMany.length, 2);
  assert.deepEqual(calls.findMany[0].where.OR[0].title.contains, 'different words');
  assert.deepEqual(calls.findMany[1].where.id, { in: [31, 17] });
  assert.equal(calls.findMany[1].where.projectId, 15);
  assert.deepEqual(pages.map((page) => page.id), [9, 31, 17]);
  assert.equal(pages[1].linkedTasks.length, 0);
});

test('an index hit outside the current board or archive scope never reaches the pages screen', async () => {
  const { service, calls } = loadPageService({
    indexRows: [{ id: '44' }],
    findMany: (args) => (args.where.id ? [] : []),
  });
  const pages = await service.listPages({ ...listArgs, archived: false, query: 'other words' });
  assert.equal(calls.findMany[1].where.archived, false);
  assert.equal(calls.findMany[1].where.projectId, 15);
  assert.deepEqual(calls.findMany[1].where.id, { in: [44] });
  assert.deepEqual(pages, []);
});

test('all boards searches the index across every project the viewer can read', async () => {
  const { service, calls } = loadPageService({
    projects: [{ id: 15 }, { id: 7049 }],
    indexRows: [{ id: '8' }],
    findMany: (args) => (args.where.id ? [pageRow({ id: 8 })] : []),
  });
  const pages = await service.listPages({ ...listArgs, projectId: undefined, query: 'pricing notes' });
  assert.equal(calls.projects.length, 1);
  assert.equal(calls.projects[0].where.status, 'Normal');
  assert.deepEqual(calls.index, [{ searchQuery: 'pricing notes', projectIds: [15, 7049], userId: 985 }]);
  assert.deepEqual(calls.findMany[1].where.id, { in: [8] });
  assert.deepEqual(pages.map((page) => page.id), [8]);
});

test("no query keeps today's list, one read, no index", async () => {
  const { service, calls } = loadPageService({ findMany: () => [pageRow({ id: 3 })] });
  const pages = await service.listPages({ ...listArgs });
  assert.deepEqual(calls.index, []);
  assert.equal(calls.findMany.length, 1);
  assert.equal(calls.findMany[0].where.OR, undefined);
  assert.deepEqual(calls.findMany[0].orderBy, { updatedAt: 'desc' });
  assert.deepEqual(pages.map((page) => page.id), [3]);
});

test('the flag off keeps the pages screen on the literal match', async () => {
  const { service, calls } = loadPageService({ flagOn: false, findMany: () => [pageRow({ id: 7 })] });
  const pages = await service.listPages({ ...listArgs, query: 'pricing notes' });
  assert.deepEqual(calls.index, []);
  assert.equal(calls.findMany.length, 1);
  assert.deepEqual(pages.map((page) => page.id), [7]);
});

test('an agent without a viewer keeps the literal match on the pages screen', async () => {
  const { service, calls } = loadPageService({ findMany: () => [pageRow({ id: 5 })] });
  const pages = await service.listPages({ ...listArgs, userId: undefined, query: 'planning notes' });
  assert.deepEqual(calls.index, []);
  assert.equal(calls.findMany.length, 1);
  assert.equal(calls.findMany[0].where.OR[1].contentText.contains, 'planning notes');
  assert.deepEqual(pages.map((page) => page.id), [5]);
});
