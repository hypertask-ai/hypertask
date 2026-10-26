const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');
const { listBrowserPages, changePageLink } = load('src/lib/pages/browser.ts', {});

const page = {
  id: 4, publicId: 'page-4', title: 'Project notes', projectId: 2,
  project: { id: 2, title: 'Project' }, updatedAt: null,
  linkedTasks: [{ id: 8, title: 'A task', ticketNumber: 'TEST-8', projectId: 2, uniqueIndex: 8 }],
};

test('active, archived and board-scoped page lists send separate queries and keep ticket links', async (t) => {
  const requests = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json({ pages: [page] });
  });
  assert.deepEqual(await listBrowserPages(), [page]);
  const signal = new AbortController().signal;
  assert.deepEqual(await listBrowserPages({ projectId: 2, archived: true, query: 'notes & plans', signal }), [page]);
  const first = new URL(requests[0].url, 'https://app.hypertask.ai');
  assert.equal(first.searchParams.get('scope'), 'all');
  assert.equal(first.searchParams.get('archived'), '0');
  assert.equal(first.searchParams.has('project_id'), false);
  const second = new URL(requests[1].url, first.origin);
  assert.equal(second.searchParams.get('scope'), 'board');
  assert.equal(second.searchParams.get('project_id'), '2');
  assert.equal(second.searchParams.get('archived'), '1');
  assert.equal(second.searchParams.get('q'), 'notes & plans');
  assert.equal(requests[1].options.signal, signal);
});

test('page list refuses failed or malformed responses instead of showing an empty success', async (t) => {
  const fetch = t.mock.method(global, 'fetch', async () => new Response('', { status: 403 }));
  await assert.rejects(listBrowserPages(), /Could not load pages/);
  fetch.mock.mockImplementation(async () => Response.json({ pages: [{ ...page, linkedTasks: null }] }));
  await assert.rejects(listBrowserPages());
});

test('link and unlink use the existing write boundary and report refused writes', async (t) => {
  const requests = [];
  const fetch = t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json({ success: true });
  });
  await changePageLink({ publicId: 'page-4', taskId: 8 });
  await changePageLink({ publicId: 'page-4', taskId: 8, remove: true });
  assert.deepEqual(requests.map(({ url, options }) => ({ url, method: options.method, body: JSON.parse(options.body) })), [
    { url: '/api/pages/page-4/links', method: 'POST', body: { task_id: 8 } },
    { url: '/api/pages/page-4/links', method: 'DELETE', body: { task_id: 8 } },
  ]);
  fetch.mock.mockImplementation(async () => new Response('', { status: 403 }));
  await assert.rejects(changePageLink({ publicId: 'page-4', taskId: 8 }), /Could not change the page link/);
});
