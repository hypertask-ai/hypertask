const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

const source = [
  { TaskId: 99, urlString: 'https://app.hypertask.ai/detail/project-15/1074?comment=7#comment-7', title: 'Bare label' },
  { TaskId: 99, urlString: '/detail/project-15/1074', title: 'HTPR-1074' },
  { TaskId: 99, urlString: 'https://app.hypertask.ai/detail/project-4060/861', title: 'https://app.hypertask.ai/detail/project-4060/861' },
  { TaskId: 99, urlString: '/detail/project-17/12', title: 'https://app.hypertask.ai/detail/project-17/12' },
  { TaskId: 99, urlString: '/detail/project-15/999', title: 'Missing ticket' },
  { TaskId: 99, urlString: 'https://example.com/detail/project-15/1074', title: 'External unchanged' },
  { TaskId: 99, urlString: 'https://app.hypertask.ai.evil.test/detail/project-15/1074', title: 'Lookalike unchanged' },
  { TaskId: 99, urlString: 'https://files.hypertask.app/image.png', title: 'image.png', Attachment: true, attachmentType: 'image/png' },
];
function harness({ allowed = true, userId = 42, lookupFails = false, status = 200 } = {}) {
  const lookups = [];
  const scope = { OR: [{ ownerId: 42 }, { members: { some: { userId: 42, agentId: null } } }] };
  const prisma = { task: {
    findFirst: async () => allowed ? { id: 99 } : null,
    findMany: async query => {
      lookups.push(query);
      assert.deepEqual(query.where.project, scope);
      assert.deepEqual(query.where.OR, [
        { projectId: 15, uniqueIndex: 1074 }, { projectId: 4060, uniqueIndex: 861 },
        { projectId: 17, uniqueIndex: 12 }, { projectId: 15, uniqueIndex: 999 },
      ]);
      assert.deepEqual(query.select, { projectId: true, uniqueIndex: true, ticketNumber: true, title: true });
      if (lookupFails) throw Error('temporary lookup failure');
      return [
        { projectId: 15, uniqueIndex: 1074, ticketNumber: 'HTPR-1074', title: 'Real current title' },
        { projectId: 4060, uniqueIndex: 861, ticketNumber: 'YPER4-861', title: 'Other readable board title' },
      ];
    },
  } };
  const mocks = {
    '@/lib/prisma': { default: prisma },
    '@/lib/constants/TaskDetail': { descriptionContainerId: 'description-container' },
    '@/utils/controllers/urls/extractUrlsFromContent': {},
    '@/lib/auth/getSessionUser': { getSessionUser: async () => userId ? { userId } : null },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: id => { assert.equal(id, 42); return scope; } },
    '@/lib/flags': { HTPR_7050_CTRL_O_LINKS_FLAG: 'htpr-7050-ctrl-o-links',
      isFeatureEnabled: async key => { assert.equal(key, 'htpr-7050-ctrl-o-links'); return false; } },
  };
  const controller = load('src/utils/controllers/urls/fetchUrls.ts', mocks);
  mocks['@/utils/controllers/urls/fetchUrls'] = { ...controller, default: async () => ({ status, json: source.map(row => ({ ...row })) }) };
  const handler = load('src/pages/api/urls/fetchUrls.ts', mocks).default;
  async function request() {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', headers: {}, query: { taskId: '99', commentId: '' } }, res);
    return res;
  }
  return { request, lookups };
}

test('authenticated URL route batches readable ticket titles, preserving links, order and attachments', async () => {
  const { request, lookups } = harness();
  const res = await request();
  assert.equal(res.code, 200);
  assert.equal(lookups.length, 1);
  assert.deepEqual(res.body.map(row => row.urlString), source.map(row => row.urlString));
  assert.deepEqual(res.body.slice(0, 3).map(row => [row.ticketNumber, row.title]), [
    ['HTPR-1074', 'Real current title'], ['HTPR-1074', 'Real current title'], ['YPER4-861', 'Other readable board title'],
  ]);
  assert.deepEqual(res.body.slice(3, 5).map(row => [row.ticketNumber, row.title]), [
    [undefined, 'PROJECT-17-12'], [undefined, 'PROJECT-15-999'],
  ]);
  assert.deepEqual(res.body.slice(5), source.slice(5));
});

test('a failed source lookup retains the response without querying any target tickets', async () => {
  const { request, lookups } = harness({ status: 503 });
  const res = await request();
  assert.equal(res.code, 503);
  assert.deepEqual(res.body, source);
  assert.equal(lookups.length, 0);
});

for (const scenario of [{ allowed: false, code: 404 }, { userId: null, code: 401 }]) {
  test(`URL route refuses target-title lookups before source-task authorization (${scenario.code})`, async () => {
    const { request, lookups } = harness(scenario);
    assert.equal((await request()).code, scenario.code);
    assert.equal(lookups.length, 0);
  });
}

test('a failed title lookup falls back to URL-derived IDs, never raw ticket URLs', async () => {
  const { request } = harness({ lookupFails: true });
  const res = await request();
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.slice(0, 5).map(row => row.title), ['PROJECT-15-1074', 'PROJECT-15-1074', 'PROJECT-4060-861', 'PROJECT-17-12', 'PROJECT-15-999']);
  assert.ok(res.body.slice(0, 5).every(row => row.ticketNumber === undefined));
  assert.deepEqual(res.body.slice(5), source.slice(5));
});
