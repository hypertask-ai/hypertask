const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');
const { run, contract, operations } = require('./page-route-entry-compat.test.cjs');

test('account-switch precedence is retained through the real session resolver and candidate reused once', async () => {
  const saved = process.env.BETTER_AUTH_ENABLED;
  process.env.BETTER_AUTH_ENABLED = '1';
  try {
    for (const operation of Object.keys(operations)) {
      let sessionReads = 0;
      const { getSessionUser } = load('src/lib/auth/getSessionUser.ts', {
        '@/lib/auth/session': { SESSION_COOKIE: 'ht_session', verifySession: () => ({ id: 985 }) },
        '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: async () => false },
        '@/lib/auth/betterAuth': { auth: { api: { getSession: async () => { sessionReads++; return { user: { id: '6' } }; } } } },
      });
      const result = await run(operation, 'ON', { mocks: { '@/lib/auth/getSessionUser': { getSessionUser } } });
      assert.deepEqual(contract(result), contract(await run(operation, 'OFF')));
      assert.deepEqual(result.probes, []);
      assert.equal(sessionReads, process.env.AUTH_LEGACY_FAST_PATH === '1' ? 0 : 1);
    }
  } finally {
    if (saved === undefined) delete process.env.BETTER_AUTH_ENABLED;
    else process.env.BETTER_AUTH_ENABLED = saved;
  }
});
test('unchanged real proxy rejects forged/mismatched profiles before page routes in session and legacy modes', async () => {
  const identity = load('src/lib/auth/cookieIdentity.ts', {
    '@/lib/auth/sessionEdge': { verifySessionEdge: async (token) => token === 'signed-985' ? { id: 985 } : null },
  });
  const { default: proxy } = load('src/proxy.ts', {
    './utils/edgeHelpers': { isValidUser: () => ({ isValid: false, user: null }) },
    './utils/serverActions': {}, './utils/helperFunctions/helperFunctions': {},
    '@/lib/auth/cookieIdentity': identity, '@/lib/auth/sessionEdge': { verifySessionEdge: async (token) => token === 'signed-985' ? { id: 985 } : null },
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
