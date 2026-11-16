const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { load } = require('./task-route-loader.cjs');
const { harness } = require('./htpr-7298-browser.test.cjs');


for (const query of ['all', 'Page']) {
  test(`review 1 mentions ${query}: trashed/foreign-origin/taskless pages stay visible`, async () => {
    {
      const h = harness({ userId: 3 });
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
        '@/lib/aiModelOptions': { aiImageModelDefinitions: [], aiModelDefinitions: [] },
        '@/utils/controllers/agents/boardMembers': { getBoardAgentMembers: async () => [] },
        '../search/document': { turbopufferFetchMentionTasks: async () => [] },
      }).default;
      const result = await mentions(query, 3, 1);
      assert.equal(result.status, 200);
      const pages = result.json.filter((row) => row.type === 'page');
      assert.deepEqual(pages.map((row) => row.id).sort(), ['foreign-origin', 'page', 'taskless', 'trashed-origin']);
      assert.equal(result.json.find((row) => row.type === 'pageHeading').count, pages.length);
    }
  });
}

{
  test('review 1 screen: new payload renders without a resolved flag', async () => {
    const h = harness({ userId: 3 });
    h.state.pages.push({ ...h.state.pages[2], id: 98, publicId: 'legacy-child', taskId: 11 });
    let flagReads = 0;
    let rawOriginOnly = false;
    let payload;
    const mocks = {
      'next/navigation': { redirect: () => { throw new Error('redirect'); } },
      './PageEditor': { default: () => null },
      '@/lib/auth/serverUser': { requireServerCookieUser: async () => ({ id: 3 }) },
      '@/lib/prisma': { default: h.prisma },
      '@/utils/controllers/pages/pageService': { getPage: async (args) => {
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
    assert.deepEqual(payload.linkedTasks.map((task) => task.id), [10, 11]);
    assert.deepEqual(payload.subPages.map((page) => page.publicId).sort(), ['legacy-child', 'visible-child']);
    assert.equal(flagReads, 0);
    h.prisma.page.findUnique = async () => ({ taskId: null });
    rawOriginOnly = true;
    await screen({ params: Promise.resolve({ publicId: 'page' }) });
    assert.equal(flagReads, 0);
  });
}

test('review 2 lists/metadata: unlinked origin refused when other links remain / linked ticket and no-link old writer still work', async () => {
  const h = harness({ userId: 3 });
  assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 10 })).status, 200);
  assert.equal(h.state.pages[0].taskId, 10);
  {
    const originRows = await h.service.listPages({ taskId: 10, userId: 3 });
    assert.equal(originRows.some((page) => page.publicId === 'page'), false);
    const linkedRows = await h.service.listPages({ taskId: 11, userId: 3 });
    assert.deepEqual(linkedRows.map((page) => page.publicId).sort(), ['old-writer-page', 'page']);
    assert.deepEqual(linkedRows.find((page) => page.publicId === 'old-writer-page').linkedTasks.map((task) => task.id), [11]);
    const page = await h.service.getPage({ publicId: 'page', userId: 3 });
    assert.deepEqual(page.linkedTasks.map((task) => task.id), [11]);
    assert.deepEqual(linkedRows.find((page) => page.publicId === 'page').linkedTasks.map((task) => task.id), [11]);
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
  test(`review 3 unlink ${taskId}: origin promotion/task locks refused / page lock and idempotent soft unlink still work`, async () => {
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
      pageTaskLink: { updateMany: async (args) => {
        calls.push('link-remove');
        assert.deepEqual(args.where, { pageId: 20, taskId, removedAt: null });
        assert.ok(args.data.removedAt instanceof Date);
        return tx.pageTaskLink.updateMany(args);
      } },
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
      calls.length = 0;
      assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: taskId })).status, 200);
      assert.deepEqual(calls, ['page-lock', 'page-read', 'link-remove']);
      assert.equal(h.state.pages[0].taskId, 10);
      const row = h.state.links.find((link) => link.pageId === 20 && link.taskId === taskId);
      if (taskId === 999) assert.equal(row, undefined);
      else assert.ok(row.removedAt instanceof Date);
      assert.equal(h.state.links.filter((link) => link.pageId === 20).length, 2);
    }
  });
}
