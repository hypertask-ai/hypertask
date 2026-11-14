const assert = require('node:assert/strict');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');

for (const resource of ['boards', 'comments', 'tasks']) {
  test(`global ${resource} counts require both session and admin capability`, async (t) => {
    const oldPassword = process.env.ADMIN_USER_RESET_PW;
    t.after(() => {
      if (oldPassword === undefined) delete process.env.ADMIN_USER_RESET_PW;
      else process.env.ADMIN_USER_RESET_PW = oldPassword;
    });
    let session = null;
    let reads = 0;
    const count = async () => { reads++; return 7; };
    const db = {
      $queryRaw: async () => { reads++; return []; },
      project: { count }, team: { count }, comment: { count }, task: { count },
    };
    const handler = load(`src/pages/api/stats/dashboard/${resource}.ts`, {
      '@/lib/prisma': { default: db },
      '@/lib/auth/getSessionUser': { getSessionUser: async () => session },
    }).default;
    const call = async (password) => {
      const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ method: 'POST', body: {}, headers: { 'x-admin-password': password } }, res);
      return res;
    };
    process.env.ADMIN_USER_RESET_PW = 'admin-count-fixture';
    assert.equal((await call('admin-count-fixture')).statusCode, 401);
    assert.equal(reads, 0);
    for (const identity of [{ userId: 6 }, { userId: 6, agentId: 'agent' }]) {
      session = identity;
      for (const password of [undefined, 'wrong']) {
        assert.equal((await call(password)).statusCode, 401);
        assert.equal(reads, 0);
      }
      delete process.env.ADMIN_USER_RESET_PW;
      assert.equal((await call('admin-count-fixture')).statusCode, 401);
      assert.equal(reads, 0);
      process.env.ADMIN_USER_RESET_PW = 'admin-count-fixture';
    }
    const allowed = await call('admin-count-fixture');
    assert.equal(allowed.statusCode, 200);
    assert.ok(reads >= 4);
    assert.ok(Object.values(allowed.body.response).includes(7));
  });
}

test('feedback accepts non-member submissions without returning destination board data', async () => {
  let session = null;
  let reads = 0;
  let created = null;
  const route = load('src/app/api/feedback/route.ts', {
    '@/lib/auth/getSessionUser': { getSessionUser: async () => session },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/prisma': { default: {
      user: { findUnique: async () => ({ id: 987, displayName: 'Customer', email: 'customer@example.invalid' }) },
      project: { findFirst: async ({ where }) => {
        reads++;
        assert.deepEqual(where, { id: 15, status: 'Normal' });
        return { uniqueIdentifier: 'HTPR', ownerId: 6, section: [{ id: 4389, section_title: 'Backlog' }] };
      } },
      label: { findFirst: async () => ({ id: 'feedback-label' }) },
      member: { findMany: async () => [] },
    } },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async (args) => {
      created = args;
      return { task: { id: 999 }, description: {} };
    } },
    '@/lib/realtime/server': { broadcastInboxChange: async () => {} },
    '@/utils/controllers/assignees/assign': { default: async () => ({ status: 200 }) },
  });
  const call = () => route.POST(new NextRequest('https://example.invalid/api/feedback', {
    method: 'POST', body: JSON.stringify({ text: 'Customer feedback', notify: false }),
    headers: { 'content-type': 'application/json' },
  }));
  assert.equal((await call()).status, 401);
  assert.equal(reads, 0);
  assert.equal(created, null);
  session = { userId: 987 };
  const allowed = await call();
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { success: true });
  assert.equal(created.projectId, 15);
  assert.equal(created.sectionId, 4389);
  assert.equal(reads, 1);
});
