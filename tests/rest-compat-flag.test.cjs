const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');
const { run, contract, operations, key } = require('./page-route-entry-compat.test.cjs');

function registry(mode = null, fail = false) {
  const users = new Map([[6, 'valentin.yeo@gmail.com'], [985, 'valentin@hypertask.ai'], [7, 'ordinary@example.com']]);
  const checks = [];
  const db = {
    user: { findUnique: async ({ where }) => ({ email: users.get(where.id) }) },
    featureFlag: {
      findUnique: async ({ where }) => {
        checks.push(where.key);
        if (fail) throw new Error('store unavailable');
        return mode === null ? null : { mode };
      },
      findMany: async () => [],
    },
  };
  const flags = load('src/lib/flags.ts', {
    '@/lib/prisma': { default: db },
    '@/lib/auth/getSessionUser': {},
    '@/lib/agentRuns/model': {},
  });
  return { flags, checks, users };
}

test('REST compatibility flag is declared exactly once with dated metadata and missing-row Owner + QA', async () => {
  const { flags } = registry();
  const keys = load('src/lib/flags/keys.ts', {});
  assert.equal(keys.HTPR_6924_REST_COMPAT_FLAG, key);
  assert.equal(flags.HTPR_6924_REST_COMPAT_FLAG, key);
  assert.equal(flags.FEATURE_FLAG_KEYS.filter((value) => value === key).length, 1);
  const entry = (await flags.listFeatureFlagModes()).find((value) => value.key === key);
  assert.equal(entry.mode, 'OWNER_AND_QA');
  assert.equal(entry.shippedOn, '2026-10-06');
  assert.equal(entry.ticketUrl, 'https://app.hypertask.ai/detail/project-15/6924');
  assert.match(entry.description, /page REST routes/);
  assert.deepEqual(await Promise.all([6, 985, 7].map((id) => flags.isFeatureEnabled(key, id))), [true, true, false]);
});
test('REST flag honors OFF and isolated Everyone, identity checks and database failure', async () => {
  for (const [mode, expected] of [['OFF', [false, false, false]], ['EVERYONE', [true, true, true]]]) {
    const { flags } = registry(mode);
    assert.deepEqual(await Promise.all([6, 985, 7].map((id) => flags.isFeatureEnabled(key, id))), expected);
  }
  const { flags, users } = registry();
  users.set(6, 'forged@example.com');
  users.set(985, 'forged@example.com');
  assert.equal(await flags.isFeatureEnabled(key, 6), false);
  assert.equal(await flags.isFeatureEnabled(key, 985), false);
  await assert.rejects(registry(null, true).flags.isFeatureEnabled(key, 6), /store unavailable/);
});
test('each page method gates shared helpers by the signed requesting user, never body/query/header opt-in', async () => {
  for (const operation of Object.keys(operations)) for (const userId of [6, 985, 7]) {
    const { flags, checks } = registry();
    let legacyChecks = 0;
    const { loadCurrentUser } = load('src/lib/auth/currentUser.ts', {
      'next/headers': { cookies: async () => ({ get: () => ({ value: 'profile' }) }) },
      '@/utils/edgeHelpers': { isValidUser: () => ({ isValid: true, user: { id: userId } }) },
      '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId }) },
    });
    const mocks = {
      '@/lib/flags': flags,
      '@/lib/auth/currentUser': { loadCurrentUser },
      '@/utils/edgeHelpers': { isValidUser: () => { legacyChecks++; return { isValid: true, user: { id: userId } }; } },
    };
    const result = await run(operation, 'ON', { userId, mocks });
    assert.deepEqual(contract(result), contract(await run(operation, 'OFF', { userId })));
    assert.deepEqual(checks, [key]);
    assert.equal(legacyChecks, userId === 7 ? 1 : 0);
  }
});
test('OFF and flag-store outage use original entry checks for owner and QA on every page method', async () => {
  for (const operation of Object.keys(operations)) for (const userId of [6, 985]) for (const [mode, fail] of [['OFF', false], [null, true]]) {
    const { flags } = registry(mode, fail);
    const result = await run(operation, 'ON', { userId, mocks: { '@/lib/flags': flags } });
    assert.deepEqual(contract(result), contract(await run(operation, 'OFF', { userId })));
  }
});
test('account-switch precedence is retained through the real session resolver and candidate reused once', async () => {
  const saved = process.env.BETTER_AUTH_ENABLED;
  process.env.BETTER_AUTH_ENABLED = '1';
  try {
    for (const operation of Object.keys(operations)) {
      let sessionReads = 0;
      const { getSessionUser } = load('src/lib/auth/getSessionUser.ts', {
        '@/lib/auth/session': { SESSION_COOKIE: 'ht_session', verifySession: () => ({ id: 985 }) },
        '@/lib/auth/betterAuth': { auth: { api: { getSession: async () => { sessionReads++; return { user: { id: '6' } }; } } } },
      });
      const result = await run(operation, 'ON', { mocks: { '@/lib/auth/getSessionUser': { getSessionUser } } });
      assert.deepEqual(contract(result), contract(await run(operation, 'OFF')));
      assert.deepEqual(result.probes, [['flag', key, 985]]);
      assert.equal(sessionReads, process.env.AUTH_LEGACY_FAST_PATH === '1' ? 0 : 1);
    }
  } finally {
    if (saved === undefined) delete process.env.BETTER_AUTH_ENABLED;
    else process.env.BETTER_AUTH_ENABLED = saved;
  }
});
test('unchanged real proxy rejects forged/mismatched profiles before page routes in ON and OFF', async () => {
  const identity = load('src/lib/auth/cookieIdentity.ts', {
    '@/lib/auth/sessionEdge': { verifySessionEdge: async (token) => token === 'signed-985' ? { id: 985 } : null },
  });
  const { default: proxy } = load('src/proxy.ts', {
    './utils/edgeHelpers': { isValidUser: () => ({ isValid: false, user: null }) },
    './utils/serverActions': {}, './utils/helperFunctions/helperFunctions': {},
    '@/lib/auth/cookieIdentity': identity, '@/lib/auth/sessionEdge': {},
  });
  for (const mode of ['ON', 'OFF']) for (const [suffix, method] of Object.values(operations)) {
    for (const cookie of ['nookies_user={"id":985}', 'nookies_user={"id":6}; ht_session=signed-985', 'nookies_user=broken; ht_session=signed-985']) {
      const request = new NextRequest(`https://fixture.invalid/api/pages/${suffix}?compat=htpr-6924&userId=6`, { method, headers: { cookie, 'x-feature-flag': mode } });
      const response = await proxy(request);
      assert.equal(response.status, 401);
      assert.equal(await response.text(), '{"error":"Unauthorized","code":"SESSION_REQUIRED"}');
      assert.deepEqual([...response.headers], [['content-type', 'application/json']]);
    }
  }
});
test('routes do not introduce 403 or remove existing unauthorized response contracts', () => {
  for (const [suffix] of Object.values(operations)) {
    const source = fs.readFileSync(path.join(__dirname, '..', `src/app/api/pages/${suffix}/route.ts`), 'utf8');
    assert.doesNotMatch(source, /status:\s*403/);
    assert.match(source, /status:\s*401/);
  }
});
