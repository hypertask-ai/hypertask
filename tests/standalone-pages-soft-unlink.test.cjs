const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');
const { harness } = require('./htpr-7298-browser.test.cjs');
const { harness: lifecycle, task, page, link } = require('./htpr-7298-lifecycle.test.cjs');

for (const source of ['task', 'description', 'comment']) {
  for (const canvas of [false, true]) {
    test(`soft unlink secondary ${source} image ${canvas ? 'canvas' : 'html'}: page reader still allowed / unrelated paste refused`, async () => {
      const h = harness({ userId: 3 });
      // The page origin is T1; the image belongs to secondary T2 on a private board.
      h.state.tasks[1].projectId = 2;
      h.state.projects[2].ownerId = 4;
      const key = 'tasks/attachments/secondary.png';
      const url = `https://files.hypertask.app/${key}`;
      const html = `<img src="${url}">`;
      h.state.pages[0].contentHtml = canvas
        ? load('src/utils/controllers/pages/htmlCanvas.ts', {}).wrapHtmlCanvas(html) : html;
      h.state.pages.push({ ...h.state.pages[0], id: 99, publicId: 'unrelated', projectId: 3, taskId: 12 });
      const attachmentTask = { id: 11, projectId: 2 };
      h.prisma.attachment = { findMany: async () => [{
        fileSource: url, [source]: source === 'task' ? attachmentTask : { task: attachmentTask },
      }] };
      const images = load('src/utils/controllers/tasks/getAccessibleAttachmentKey.ts', {
        '@/lib/prisma': { default: h.prisma },
        '@/lib/storage/hypertasksS3': { parseHypertasksStorageKeyFromUrl: (value) => value.startsWith('https://files.hypertask.app/') ? value.slice('https://files.hypertask.app/'.length) : null },
      });
      assert.equal(await images.getAccessibleAttachmentKey(url, 1), key);
      assert.equal(await images.getAccessibleAttachmentKey(url, 4), null);
      assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 11 })).status, 200);
      const edge = h.state.links.find((row) => row.taskId === 11);
      assert.ok(edge.removedAt instanceof Date);
      assert.equal(h.state.pages[0].taskId, 10);
      assert.equal(await images.getAccessibleAttachmentKey(url, 1), key);
      assert.equal(await images.getAccessibleAttachmentKey(url, 4), null);
      assert.equal(await images.getAccessibleAttachmentKey(url, 2), key);
      // Without any historical association, even the same page/content cannot grant access.
      h.state.links = h.state.links.filter((row) => row.taskId !== 11);
      assert.equal(await images.getAccessibleAttachmentKey(url, 1), null);
    });
  }
}

test('soft unlink final link: origin list resurrection refused / legacy zero-row page and flag-off origin still listed', async () => {
  const h = harness({ userId: 3 });
  for (const task_id of [10, 11]) {
    assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id })).status, 200);
  }
  assert.equal(h.state.links.length, 2);
  assert.ok(h.state.links.every((row) => row.removedAt instanceof Date));
  assert.equal(h.state.pages[0].taskId, 10);
  for (const taskId of [10, 11]) {
    const rows = await h.service.listPages({ taskId, userId: 3 });
    assert.equal(rows.some((row) => row.publicId === 'page'), false);
    assert.equal(rows.some((row) => row.publicId === 'old-writer-page'), taskId === 11);
    const response = await h.request('list', 'GET', undefined, `task_id=${taskId}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.pages.map((row) => row.publicId).sort(), rows.map((row) => row.publicId).sort());
  }
  const legacy = await h.service.listPages({ taskId: 10, userId: 3, standalonePagesEnabled: false });
  assert.ok(legacy.some((row) => row.publicId === 'page'));
  assert.deepEqual(legacy.find((row) => row.publicId === 'page').linkedTasks.map((row) => row.id), [10]);
  assert.deepEqual((await h.service.getPage({ publicId: 'page', userId: 3 })).linkedTasks, []);
  const board = await h.request('list', 'GET', undefined, 'scope=board&project_id=1');
  assert.equal(board.status, 200);
  assert.equal(board.body.count, board.body.pages.length);
  assert.deepEqual(board.body.pages.find((row) => row.publicId === 'page').linkedTasks, []);
});

test('soft unlink relink: removed association excluded from lists/metadata / POST reactivates the same attributed row', async () => {
  const h = harness({ userId: 3 });
  const original = structuredClone(h.state.links[1]);
  assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 11 })).status, 200);
  const removedAt = h.state.links[1].removedAt;
  assert.ok(removedAt instanceof Date);
  assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 11 })).status, 200);
  assert.equal(h.state.links[1].removedAt, removedAt, 'repeated unlink retains original removal timestamp');
  assert.deepEqual((await h.service.getPage({ publicId: 'page', userId: 3 })).linkedTasks.map((row) => row.id), [10]);
  assert.equal((await h.service.listPages({ taskId: 11, userId: 3 })).some((row) => row.publicId === 'page'), false);
  for (let i = 0; i < 2; i++) assert.equal((await h.request('[publicId]/links', 'POST', { task_id: 11 })).status, 200);
  assert.equal(h.state.links.length, 2);
  assert.deepEqual(h.state.links[1], original);
  assert.equal(h.state.pages[0].taskId, 10);
  assert.deepEqual((await h.service.getPage({ publicId: 'page', userId: 3 })).linkedTasks.map((row) => row.id), [10, 11]);
  const rows = await h.service.listPages({ taskId: 11, userId: 3 });
  assert.deepEqual(rows.find((row) => row.publicId === 'page').linkedTasks.map((row) => row.id), [10, 11]);
});

test('soft unlink origin then move secondary: origin recreation refused / sole active ticket carries page on same old board', async () => {
  const browser = harness({ userId: 3 });
  assert.equal((await browser.request('[publicId]/links', 'DELETE', { task_id: 10 })).status, 200);
  const removedAt = browser.state.links[0].removedAt;
  const links = browser.state.links.map((edge) => link(10, edge.taskId === 10 ? 21 : 20, { removedAt: edge.removedAt }));
  const h = lifecycle({ tasks: [task(20), task(21)], pages: [page(10, 21)], links });
  assert.equal((await h.move()).success, true);
  assert.equal(h.state().pages[0].projectId, 2);
  assert.equal(h.state().pages[0].taskId, 21);
  assert.deepEqual(h.state().links, links);
  assert.equal(h.state().links.find((row) => row.taskId === 21).removedAt.getTime(), removedAt.getTime());
  assert.equal(h.calls.includes('materialize'), false);
});

test('soft unlink zero active links: removed origin never materialized or moved / no-row legacy origin materialized and moved', async () => {
  for (const removed of [false, true]) {
    const links = removed ? [link(10, 20, { removedAt: new Date('2026-10-18') })] : [];
    const h = lifecycle({ pages: [page(10)], links });
    assert.equal((await h.move()).success, true);
    assert.equal(h.state().pages[0].projectId, removed ? 1 : 2);
    assert.equal(h.calls.includes('materialize'), !removed);
    assert.equal(h.state().links.length, 1);
    if (removed) assert.deepEqual(h.state().links, links);
    else {
      assert.equal(h.state().links[0].removedAt, null);
      assert.equal(h.state().links[0].createdAt.getTime(), h.state().pages[0].createdAt.getTime());
    }
  }
});

test('soft unlink sole active link rule: removed secondary ignored / active secondary still prevents page move', async () => {
  for (const removedAt of [null, new Date('2026-10-18')]) {
    const links = [link(10, 20), link(10, 21, { removedAt })];
    const h = lifecycle({ tasks: [task(20), task(21)], links });
    assert.equal((await h.move()).success, true);
    assert.equal(h.state().pages[0].projectId, removedAt ? 2 : 1);
    assert.deepEqual(h.state().links, links);
  }
});

test('soft unlink permanent delete: oldest removed survivor never promoted / oldest active survivor promoted and all deleted-ticket edges cascade', async () => {
  for (const hasActive of [false, true]) {
    const links = [link(10, 20), link(10, 21, { removedAt: new Date('2026-10-18'), createdAt: new Date('2020-01-01') })];
    if (hasActive) links.push(link(10, 22), link(10, 23, { createdAt: new Date('2025-01-01') }));
    links.push(link(11, 20, { removedAt: new Date('2026-10-18') }));
    const h = lifecycle({ tasks: [task(20, { status: 'Deleted' }), task(21), task(22), task(23)], pages: [page(10), page(11, 21)], links });
    assert.equal(await h.delete(), 'success');
    assert.equal(h.state().pages[0].taskId, hasActive ? 23 : null);
    assert.equal(h.state().pages[1].taskId, 21);
    assert.equal(h.state().pages.length, 2);
    assert.equal(h.state().links.some((row) => row.taskId === 20), false);
    assert.deepEqual(h.state().links, links.filter((row) => row.taskId !== 20));
  }
});
