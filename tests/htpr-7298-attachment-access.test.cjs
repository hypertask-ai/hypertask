const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

function matches(row, where = {}) {
  if (row == null) return false;
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return expected.some((part) => matches(row, part));
    if (key === 'AND') return expected.every((part) => matches(row, part));
    const value = row[key];
    if (expected === null || typeof expected !== 'object') return value === expected;
    if ('some' in expected) return value.some((item) => matches(item, expected.some));
    if ('not' in expected) return value !== expected.not;
    if ('in' in expected) return expected.in.includes(value);
    if ('contains' in expected) return String(value).includes(expected.contains);
    return matches(value, expected);
  });
}
const access = load('src/utils/controllers/projects/getAllIncludes.ts', {
  '@/lib/agents/publicAgent': {}, '@/lib/cycles': {}, '@/lib/agents/visibility': {},
  '@/utils/controllers/notifications/visibleInboxScope': {},
});
const key = 'tasks/attachments/moved-image.png';
const url = `https://files.hypertask.app/${key}`;
const boards = [
  { id: 1, status: 'Normal', ownerId: 1, members: [] },
  { id: 2, status: 'Normal', ownerId: 2, members: [] },
  { id: 3, status: 'Normal', ownerId: 3, members: [] },
];
function fixture({ source = 'task', legacy = false, archived = false, contentHtml = `<img src="${url}">` } = {}) {
  const task = { id: 10, projectId: 2 };
  const attachment = { fileSource: url, [source]: source === 'task' ? task : { task } };
  const pages = [
    { project: boards[0], archived, taskId: legacy ? 10 : 11, links: [{ taskId: 10 }, { taskId: 11 }], contentHtml },
    { project: boards[2], archived: false, taskId: 30, links: [{ taskId: 30 }], contentHtml: `<img src="${url}">` },
  ];
  const queries = [];
  const service = load('src/utils/controllers/tasks/getAccessibleAttachmentKey.ts', {
    '@/lib/storage/hypertasksS3': { parseHypertasksStorageKeyFromUrl: (value) => value.startsWith('https://files.hypertask.app/') ? value.slice('https://files.hypertask.app/'.length) : null },
    '@/lib/prisma': { default: {
      attachment: { findMany: async () => [attachment] },
      project: { findFirst: async ({ where }) => boards.find((board) => matches(board, where)) ?? null },
      page: { findMany: async ({ where }) => { queries.push(where); return pages.filter((page) => matches(page, where)); } },
      description: { findMany: async () => assert.fail('inaccessible attachment must not use arbitrary description references') },
      comment: { findMany: async () => assert.fail('inaccessible attachment must not use arbitrary comment references') },
      chatSession: { findFirst: async () => assert.fail('inaccessible attachment must not use arbitrary chat keys') },
    } },
    '@/utils/controllers/projects/getAllIncludes': access,
  });
  return { ...service, pages, queries };
}
for (const source of ['task', 'description', 'comment']) {
  for (const legacy of [false, true]) {
    test(`${source} image after ticket move (${legacy ? 'legacy pointer' : 'PageTaskLink'}): linked A reader allowed / pasted unlinked C reader refused / attachment B reader still allowed`, async () => {
      const h = fixture({ source, legacy });
      if (legacy) h.pages[0].links = [{ taskId: 11 }];
      assert.equal(await h.getAccessibleAttachmentKey(url, 1), key);
      assert.equal(await h.getAccessibleAttachmentKey(url, 3), null);
      assert.equal(await h.getAccessibleAttachmentKey(url, 2), key);
      assert.equal(h.queries.length, 2, 'accessible attachment board needs no page fallback');
      assert.equal(h.queries[0].archived, false);
    });
  }
}
test('archived linked page refused / non-archived linked page still works', async () => {
  const h = fixture({ archived: true });
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), null);
  h.pages[0].archived = false;
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), key);
});
test('inaccessible page board refused / accessible page board still works', async () => {
  const h = fixture();
  for (const project of [boards[1], boards[2]]) {
    h.pages[0].project = project;
    assert.equal(await h.getAccessibleAttachmentKey(url, 1), null);
  }
  h.pages[0].project = boards[0];
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), key);
});
test('substring-only key reference refused / exact image reference still works', async () => {
  const h = fixture({ contentHtml: `<img src="${url}.foreign">` });
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), null);
  h.pages[0].contentHtml = `<img src="${url}">`;
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), key);
});
test('linked canvas image allowed / unlinked pasted canvas image refused', async () => {
  const { wrapHtmlCanvas } = load('src/utils/controllers/pages/htmlCanvas.ts', {});
  const h = fixture({ contentHtml: wrapHtmlCanvas(`<img src="${url}">`) });
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), key);
  h.pages[1].contentHtml = h.pages[0].contentHtml;
  assert.equal(await h.getAccessibleAttachmentKey(url, 3), null);
});

test('standalone image B after unlink still authorized / removing historical link or page access is refused', async () => {
  const h = fixture();
  h.pages[0].taskId = null;
  h.pages[0].links = [{ taskId: 10, removedAt: new Date() }];
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), key);
  assert.equal(await h.getAccessibleAttachmentKey(url, 3), null);
  h.pages[0].links = [];
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), null);
  h.pages[0].links = [{ taskId: 10, removedAt: null }];
  assert.equal(await h.getAccessibleAttachmentKey(url, 1), key);
});
