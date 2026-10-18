const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { load } = require('./task-route-loader.cjs');
const { harness } = require('./htpr-7298-browser.test.cjs');

const flag = 'htpr-7298-standalone-pages';

for (const query of ['all', 'Page']) {
  test(`review 1 mentions ${query}: flag-off trashed/foreign-origin/taskless pages refused / legacy still works`, async () => {
    for (const enabled of [false, true]) {
      const h = harness({ userId: 3, flag: enabled });
      h.state.tasks[0].projectId = 1;
      h.state.pages = [h.state.pages[0]];
      h.state.pages.push(...[
        { id: 101, publicId: 'trashed-origin', taskId: 14 },
        { id: 102, publicId: 'foreign-origin', taskId: 12 },
        { id: 103, publicId: 'taskless', taskId: null },
        { id: 104, publicId: 'archived', taskId: 10, archived: true },
      ].map((fields) => ({ ...h.state.pages[0], ...fields })));
      h.state.tasks.push({ ...h.state.tasks[0], id: 14, status: 'Deleted', deletedAt: new Date(0) });
      h.prisma.task.findMany = async () => [];
      h.prisma.user = { findFirst: async () => ({ id: 332, displayName: 'HyperAI' }) };
      const mentions = load('src/utils/controllers/tasks/taskSearchByParam.ts', {
        '@/lib/prisma': { default: h.prisma },
        '@/app/api/ai/_lib/planGate': { haiku55ModelEnabled: async () => false },
        '@/lib/flags': { PAGE_MENTIONS_FLAG: 'mentions', isFeatureEnabled: async (key) => key === flag ? enabled : true },
        '@/lib/aiModelOptions': { aiImageModelDefinitions: [], aiModelDefinitions: [] },
        '@/utils/controllers/agents/boardMembers': { getBoardAgentMembers: async () => [] },
        '../search/document': { turbopufferFetchMentionTasks: async () => [] },
      }).default;
      const result = await mentions(query, 3, 1);
      assert.equal(result.status, 200);
      const pages = result.json.filter((row) => row.type === 'page');
      assert.deepEqual(pages.map((row) => row.id).sort(), enabled
        ? ['foreign-origin', 'page', 'taskless', 'trashed-origin'] : ['page']);
      assert.equal(result.json.find((row) => row.type === 'pageHeading').count, pages.length);
      const where = h.queries.at(-1).where;
      if (!enabled) {
        assert.deepEqual(where.task, { projectId: 1, deletedAt: null });
        assert.deepEqual(where.taskId, { not: null });
      }
    }
  });
}

for (const enabled of [false, true]) {
  test(`review 1 screen flag ${enabled}: new payload refused when off / legacy payload and one resolved flag still work`, async () => {
    const h = harness({ userId: 3, flag: enabled });
    h.state.pages.push({ ...h.state.pages[2], id: 98, publicId: 'legacy-child', taskId: 11 });
    let flagReads = 0;
    let rawOriginOnly = false;
    let payload;
    const mocks = {
      'next/navigation': { redirect: () => { throw new Error('redirect'); } },
      './PageEditor': { default: () => null },
      '@/lib/auth/serverUser': { requireServerCookieUser: async () => ({ id: 3 }) },
      '@/lib/flags': { isFeatureEnabled: async (key, userId) => {
        assert.equal(key, flag);
        assert.equal(userId, 3);
        flagReads++;
        assert.equal(flagReads, 1, 'resolve exactly once even when checking a taskless origin');
        return enabled;
      } },
      '@/lib/flags/keys': { HTPR_7298_STANDALONE_PAGES_FLAG: flag },
      '@/lib/prisma': { default: h.prisma },
      '@/utils/controllers/pages/pageService': { getPage: async (args) => {
        assert.equal(args.standalonePagesEnabled, enabled);
        return rawOriginOnly ? payload : h.service.getPage(args);
      } },
      '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    };
    const filename = path.join(__dirname, '../src/app/page/[publicId]/page.tsx');
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const target = { exports: {} };
    new Function('require', 'module', 'exports', compiled)((id) => Object.hasOwn(mocks, id)
      ? { __esModule: true, ...mocks[id] } : require(id), target, target.exports);
    const screen = target.exports.default;
    const rendered = await screen({ params: Promise.resolve({ publicId: 'page' }) });
    payload = JSON.parse(rendered.props._page);
    assert.deepEqual(payload.linkedTasks.map((task) => task.id), enabled ? [10, 11] : [10]);
    assert.deepEqual(payload.subPages.map((page) => page.publicId).sort(), enabled ? ['legacy-child', 'visible-child'] : ['legacy-child']);
    assert.equal(flagReads, 1);
    // Exercise the explicit raw-origin redirect with a sanitized non-null legacy task response.
    h.prisma.page.findUnique = async () => ({ taskId: null });
    rawOriginOnly = true;
    flagReads = 0;
    if (enabled) await screen({ params: Promise.resolve({ publicId: 'page' }) });
    else await assert.rejects(screen({ params: Promise.resolve({ publicId: 'page' }) }), /redirect/);
    assert.equal(flagReads, 1);
  });
}

test('review 2 lists/metadata: unlinked origin refused when other links remain / linked ticket and no-link old writer still work', async () => {
  const h = harness({ userId: 3 });
  assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 10 })).status, 200);
  assert.equal(h.state.pages[0].taskId, 10);
  for (const enabled of [false, true]) {
    const originRows = await h.service.listPages({ taskId: 10, userId: 3, standalonePagesEnabled: enabled });
    assert.equal(originRows.some((page) => page.publicId === 'page'), !enabled);
    const linkedRows = await h.service.listPages({ taskId: 11, userId: 3, standalonePagesEnabled: enabled });
    assert.deepEqual(linkedRows.map((page) => page.publicId).sort(), enabled ? ['old-writer-page', 'page'] : ['old-writer-page']);
    assert.deepEqual(linkedRows.find((page) => page.publicId === 'old-writer-page').linkedTasks.map((task) => task.id), enabled ? [] : [11]);
    const page = await h.service.getPage({ publicId: 'page', userId: 3, standalonePagesEnabled: enabled });
    assert.deepEqual(page.linkedTasks.map((task) => task.id), enabled ? [11] : [10]);
    if (enabled) assert.deepEqual(linkedRows.find((page) => page.publicId === 'page').linkedTasks.map((task) => task.id), [11]);
  }
  assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 11 })).status, 200);
  assert.equal(h.state.pages[0].taskId, 10);
  assert.deepEqual((await h.service.getPage({ publicId: 'page', userId: 3 })).linkedTasks, []);
});

for (const source of ['task', 'description', 'comment']) {
  test(`review 2 ${source} image: foreign paste still refused / origin image survives unlinking every ticket`, async () => {
    const h = harness({ userId: 1 });
    const key = 'tasks/attachments/origin.png';
    const url = `https://files.hypertask.app/${key}`;
    h.state.projects[2].ownerId = 4;
    h.state.pages[0].contentHtml = `<img src="${url}">`;
    h.state.pages.push({ ...h.state.pages[0], id: 99, publicId: 'foreign-paste', projectId: 3, taskId: 12 });
    const task = { id: 10, projectId: 2 };
    h.prisma.attachment = { findMany: async () => [{ fileSource: url, [source]: source === 'task' ? task : { task } }] };
    const images = load('src/utils/controllers/tasks/getAccessibleAttachmentKey.ts', {
      '@/lib/prisma': { default: h.prisma },
      '@/lib/storage/hypertasksS3': { parseHypertasksStorageKeyFromUrl: (value) => value.startsWith('https://files.hypertask.app/') ? value.slice('https://files.hypertask.app/'.length) : null },
    });
    assert.equal(await images.getAccessibleAttachmentKey(url, 1), key);
    assert.equal(await images.getAccessibleAttachmentKey(url, 4), null);
    for (const task_id of [10, 11]) {
      assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id })).status, 200);
      assert.equal(h.state.pages[0].taskId, 10);
      assert.equal(await images.getAccessibleAttachmentKey(url, 1), key);
      assert.equal(await images.getAccessibleAttachmentKey(url, 4), null);
      assert.equal(await images.getAccessibleAttachmentKey(url, 2), key);
    }
  });
}

for (const taskId of [10, 11, 999]) {
  test(`review 3 unlink ${taskId}: origin promotion/task locks refused / page lock and idempotent link delete still work`, async () => {
    const h = harness({ userId: 1 });
    const transaction = h.prisma.$transaction;
    const calls = [];
    h.prisma.$transaction = (callback) => transaction((tx) => callback({
      $queryRaw: async (strings, ...values) => {
        calls.push('page-lock');
        assert.match(strings.join('?'), /^SELECT "id" FROM "Page" WHERE "publicId" = \? FOR UPDATE$/);
        assert.deepEqual(values, ['page']);
        return tx.$queryRaw(strings, ...values);
      },
      page: { findFirst: async (args) => { calls.push('page-read'); return tx.page.findFirst(args); } },
      pageTaskLink: { deleteMany: async (args) => {
        calls.push('link-delete');
        assert.deepEqual(args, { where: { pageId: 20, taskId } });
        return tx.pageTaskLink.deleteMany(args);
      } },
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
      calls.length = 0;
      assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: taskId })).status, 200);
      assert.deepEqual(calls, ['page-lock', 'page-read', 'link-delete']);
      assert.equal(h.state.pages[0].taskId, 10);
      assert.equal(h.state.links.some((link) => link.pageId === 20 && link.taskId === taskId), false);
    }
  });
}
