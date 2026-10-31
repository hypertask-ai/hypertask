const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

async function run({ cookie, session = { userId: 985 }, row = 'row', queryThrows = false }) {
  const queries = [];
  const mod = load('src/lib/auth/currentUser.ts', {
    'next/headers': { cookies: async () => ({ get: () => (cookie === undefined ? undefined : { value: JSON.stringify(cookie) }) }) },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => session },
    '@/utils/edgeHelpers': { isValidUser: (value) => {
      try { const user = JSON.parse(value); return { isValid: Boolean(user.id && user.displayName && user.email), user }; }
      catch { return { isValid: false, user: null }; }
    } },
    '@/lib/prisma': { default: { user: { findUnique: async (args) => {
      queries.push(args);
      if (queryThrows) throw new Error('db down');
      return row === null ? null : { id: args.where.id, displayName: 'Real', email: 'real@fixture.invalid', UserSetting: { notificationPreference: 'email' }, userPicture: null };
    } } } },
  });
  const result = await mod.loadCurrentUser(new Headers(), true);
  return { result, queries };
}

const goodCookie = { id: 985, displayName: 'Cookie', email: 'cookie@fixture.invalid' };

test('valid matching profile cookie is used as before: no query', async () => {
  const { result, queries } = await run({ cookie: goodCookie });
  assert.equal(result.userId, 985);
  assert.equal(result.user.displayName, 'Cookie');
  assert.deepEqual(queries, []);
});

test('missing profile cookie with a valid session loads the profile from the database with one query', async () => {
  const { result, queries } = await run({});
  assert.equal(result.userId, 985);
  assert.equal(result.user.id, 985);
  assert.equal(result.user.email, 'real@fixture.invalid');
  assert.equal(result.user.notificationPreference, 'email');
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].where, { id: 985 });
});

test('mismatched profile cookie never wins: the session user is loaded instead', async () => {
  const { result, queries } = await run({ cookie: { ...goodCookie, id: 7 } });
  assert.equal(result.userId, 985);
  assert.equal(result.user.id, 985);
  assert.notEqual(result.user.displayName, 'Cookie');
  assert.deepEqual(queries.map((q) => q.where), [{ id: 985 }]);
});

test('invalid profile cookie falls back to the session user', async () => {
  const { result } = await run({ cookie: { id: 985 } });
  assert.equal(result.user.displayName, 'Real');
});

test('agent identity comes from the signed session for matching, missing and mismatched profiles', async () => {
  for (const cookie of [undefined, { ...goodCookie, agentId: 'forged-agent' }, { ...goodCookie, id: 7 }]) {
    const { result } = await run({ cookie, session: { userId: 985, agentId: 'agent-1' } });
    assert.equal(result.userId, 985);
    assert.equal(result.agentId, 'agent-1');
    assert.equal(result.user.id, 985);
  }
});

test('no session returns null without a query', async () => {
  const { result, queries } = await run({ session: null });
  assert.equal(result, null);
  assert.deepEqual(queries, []);
});

test('unknown user row and query failure all keep the legacy null', async () => {
  assert.equal((await run({ row: null })).result, null);
  assert.equal((await run({ queryThrows: true })).result, null);
});
