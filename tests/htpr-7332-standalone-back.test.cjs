const assert = require('node:assert/strict');
const test = require('node:test');
const { harness } = require('./htpr-7298-browser.test.cjs');

for (const unlink of [false, true]) {
  test(`standalone link B${unlink ? ' then unlink: stale Back to task refused / Back to board works' : ': Back to board replaced / Back to task B works'}; origin remains null`, async () => {
    const h = harness({ userId: 3 });
    h.state.pages[0].taskId = null;
    h.state.links = [];
    assert.equal((await h.request('[publicId]/links', 'POST', { task_id: 11 })).status, 200);
    assert.equal(h.state.pages[0].taskId, null, 'linking must never replace the standalone origin');
    if (unlink) {
      assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 11 })).status, 200);
      assert.ok(h.state.links[0].removedAt instanceof Date);
    }
    const { body, status } = await h.request('[publicId]');
    assert.equal(status, 200);
    assert.equal(body.page.task?.id ?? null, unlink ? null : 11);
    assert.equal(body.page.taskId, null, 'serialized origin remains null too');
    assert.equal(Object.hasOwn(body.page, '_count'), false);
    assert.equal(h.state.links.filter((link) => link.pageId === 20).length, 1);
    assert.deepEqual(body.page.linkedTasks.map((task) => task.id), unlink ? [] : [11]);
    assert.equal(h.state.pages[0].taskId, null);
  });
}

for (const enabled of [false, true]) {
  test(`flag ${enabled ? 'on' : 'off'}: legacy page without link rows follows visible origin A`, async () => {
    const h = harness({ userId: 3, flag: enabled });
    h.state.links = [];
    const { body, status } = await h.request('[publicId]');
    assert.equal(status, 200);
    assert.equal(body.page.task.id, 10);
    assert.equal(body.page.taskId, 10);
    assert.deepEqual(body.page.linkedTasks.map((task) => task.id), [10]);
    assert.equal(Object.hasOwn(body.page, '_count'), false);
    assert.deepEqual(h.queries.at(-1).include._count, { select: { links: true } });
    assert.equal(h.state.links.length, 0, 'reading a legacy page does not materialize a link');
  });

  test(`flag ${enabled ? 'on: origin A with only a soft-removed link returns Back to board' : 'off: origin A with only a soft-removed link still follows origin'}`, async () => {
    const h = harness({ userId: 3, flag: enabled });
    h.state.links = [h.state.links[0]];
    h.state.links[0].removedAt = new Date();
    const { body, status } = await h.request('[publicId]');
    assert.equal(status, 200);
    assert.equal(body.page.task?.id ?? null, enabled ? null : 10);
    assert.equal(body.page.taskId, 10, 'removed links do not erase the creation origin');
    assert.deepEqual(body.page.linkedTasks.map((task) => task.id), enabled ? [] : [10]);
    assert.equal(Object.hasOwn(body.page, '_count'), false);
    assert.equal(h.state.links.length, 1);
    assert.ok(h.state.links[0].removedAt instanceof Date);
  });
}

test('ticket-created origin A active still works / unlinked A refused in favor of active C', async () => {
  const h = harness({ userId: 3 });
  assert.equal((await h.request('[publicId]')).body.page.task.id, 10);
  assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 10 })).status, 200);
  assert.equal((await h.request('[publicId]')).body.page.task.id, 11);
  assert.equal(h.state.pages[0].taskId, 10, 'unlinking retains the creation origin');
  assert.equal((await h.request('[publicId]/links', 'DELETE', { task_id: 11 })).status, 200);
  assert.equal((await h.request('[publicId]')).body.page.task, null);
});

test('flag off keeps legacy origin A / flag on refuses unlinked A and selects active C', async () => {
  for (const enabled of [false, true]) {
    const h = harness({ userId: 3, flag: enabled });
    h.state.links[0].removedAt = new Date();
    const { body, status } = await h.request('[publicId]');
    assert.equal(status, 200);
    assert.equal(body.page.task.id, enabled ? 11 : 10);
    assert.equal(body.page.taskId, 10);
    assert.deepEqual(body.page.linkedTasks.map((task) => task.id), enabled ? [11] : [10]);
  }
});

test('hidden, Deleted and archived-board links refused / first active visible link ordered by createdAt then id still works', async () => {
  const h = harness({ userId: 1 });
  h.state.tasks.push({ id: 14, projectId: 1, title: 'Earlier ticket', uniqueIndex: 14, status: 'Normal' });
  h.state.tasks.push({ id: 15, projectId: 4, title: 'ARCHIVED-TICKET', uniqueIndex: 15, status: 'Normal' });
  h.state.links.push(
    { id: 0, pageId: 20, taskId: 13, createdAt: new Date(0), removedAt: null },
    { id: 3, pageId: 20, taskId: 14, createdAt: new Date(1), removedAt: null },
    { id: 4, pageId: 20, taskId: 15, createdAt: new Date(0), removedAt: null },
  );
  // Shuffle storage order so the fixture must honor the ORM order, not insertion order.
  h.state.links.reverse();
  let result = await h.service.getPage({ publicId: 'page', userId: 1, standalonePagesEnabled: true });
  assert.equal(result.task.id, 11, 'equal timestamps use the lower link id');
  assert.deepEqual(result.linkedTasks.map((task) => task.id), [11, 14]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|Deleted ticket|ARCHIVED-TICKET/);
  h.state.links.find((link) => link.taskId === 14).createdAt = new Date(0);
  result = await h.service.getPage({ publicId: 'page', userId: 1, standalonePagesEnabled: true });
  assert.equal(result.task.id, 14, 'earlier creation wins regardless of link id');
  h.state.links.find((link) => link.taskId === 14).removedAt = new Date();
  assert.equal((await h.service.getPage({ publicId: 'page', userId: 1, standalonePagesEnabled: true })).task.id, 11);
});
