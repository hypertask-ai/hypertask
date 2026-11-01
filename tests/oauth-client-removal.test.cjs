const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const routePath = path.join(
  root,
  "src/app/api/connections/[clientId]/route.ts",
);
const prismaPath = path.join(root, "src/lib/prisma.ts");
const sessionPath = path.join(root, "src/lib/auth/getSessionUser.ts");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
let activePrisma;
let activeSessionUserId = null;
const prismaProxy = {
  $transaction: (...args) => activePrisma.$transaction(...args),
};
const sessionProxy = {
  getSessionUser: async () =>
    activeSessionUserId === null
      ? null
      : {
          userId: activeSessionUserId,
          source: "legacy",
          needsBridge: true,
        },
};

function loadRoute({
  sessionUserId = 6,
  clientExists = true,
  ownerUserId = 6,
  authorizationCodes = [{ user_id: 6, used: true }],
  refreshTokens = [
    {
      userId: 6,
      accessTokenJti: "selected-client-access-token",
      accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  ],
  deleteError = null,
  transactionErrors = [],
} = {}) {
  const calls = {
    queries: [],
    revokedTokenUpserts: [],
    clientDeletes: [],
    committed: [],
    rolledBack: 0,
    transactions: 0,
  };
  let transactionErrorIndex = 0;
  const prisma = {
    $transaction: async (callback) => {
      calls.transactions += 1;
      const configuredError = transactionErrors[transactionErrorIndex++];
      if (configuredError) throw configuredError;

      const staged = [];
      let queryIndex = 0;
      const tx = {
        $queryRaw: async (strings, ...values) => {
          const sql = strings.join("?");
          calls.queries.push({ sql, values });
          queryIndex += 1;
          assert.deepEqual(values, ["owned-client"]);
          if (queryIndex === 1) {
            assert.match(
              sql,
              /FROM "OAuthClient"\s+WHERE "client_id" = \?\s+FOR UPDATE/,
            );
            return clientExists
              ? [{ client_id: values[0], owner_id: ownerUserId }]
              : [];
          }
          if (queryIndex === 2) {
            assert.match(
              sql,
              /FROM "OAuthAuthorizationCode"\s+WHERE "client_id" = \?\s+FOR UPDATE/,
            );
            return authorizationCodes;
          }
          if (queryIndex === 3) {
            assert.match(
              sql,
              /FROM "OAuthRefreshToken"\s+WHERE "clientId" = \?\s+FOR UPDATE/,
            );
            return refreshTokens;
          }
          throw new Error("Unexpected query");
        },
        revokedToken: {
          upsert: async (args) => {
            calls.revokedTokenUpserts.push(args);
            staged.push(["revokedToken", args]);
            return {};
          },
        },
        oAuthClient: {
          delete: async (args) => {
            calls.clientDeletes.push(args);
            if (deleteError) throw deleteError;
            staged.push(["client", args]);
            return {};
          },
        },
      };

      try {
        const result = await callback(tx);
        calls.committed.push(...staged);
        return result;
      } catch (error) {
        calls.rolledBack += 1;
        throw error;
      }
    },
  };

  activePrisma = prisma;
  activeSessionUserId = sessionUserId;
  require.cache[prismaPath] = {
    id: prismaPath,
    filename: prismaPath,
    loaded: true,
    exports: { __esModule: true, default: prismaProxy },
  };
  require.cache[sessionPath] = {
    id: sessionPath,
    filename: sessionPath,
    loaded: true,
    exports: sessionProxy,
  };

  const { DELETE } = jiti(routePath);
  return { DELETE, calls };
}

function request(clientId, { origin = "https://app.hypertask.ai" } = {}) {
  return new NextRequest(
    `https://app.hypertask.ai/api/connections/${encodeURIComponent(clientId)}`,
    {
      method: "DELETE",
      headers: {
        Host: "app.hypertask.ai",
        ...(origin ? { Origin: origin } : {}),
      },
    },
  );
}

async function remove(DELETE, clientId = "owned-client", options) {
  return DELETE(request(clientId, options), {
    params: Promise.resolve({ clientId }),
  });
}

test("OAuth client removal requires a signed browser session", async () => {
  const { DELETE, calls } = loadRoute({ sessionUserId: null });
  const response = await remove(DELETE);

  assert.equal(response.status, 401);
  assert.equal(calls.transactions, 0);
});

test("OAuth client removal rejects a cross-site request before database access", async () => {
  const { DELETE, calls } = loadRoute();
  const response = await remove(DELETE, "owned-client", {
    origin: "https://attacker.example",
  });

  assert.equal(response.status, 403);
  assert.equal(calls.transactions, 0);
});

test("OAuth client removal rejects an HTTP origin for the HTTPS host", async () => {
  const { DELETE, calls } = loadRoute();
  const response = await remove(DELETE, "owned-client", {
    origin: "http://app.hypertask.ai",
  });

  assert.equal(response.status, 403);
  assert.equal(calls.transactions, 0);
});

test("a different user cannot remove an OAuth client or learn whether it exists", async () => {
  const { DELETE, calls } = loadRoute({
    sessionUserId: 7,
    authorizationCodes: [{ user_id: 7, used: true }],
    refreshTokens: [],
  });
  const response = await remove(DELETE);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Client not found",
  });
  assert.deepEqual(calls.revokedTokenUpserts, []);
  assert.deepEqual(calls.clientDeletes, []);
  assert.deepEqual(calls.committed, []);
});

test("authorization history cannot remove an unowned registration", async () => {
  const { DELETE, calls } = loadRoute({ ownerUserId: null });
  const response = await remove(DELETE);

  assert.equal(response.status, 404);
  assert.deepEqual(calls.revokedTokenUpserts, []);
  assert.deepEqual(calls.clientDeletes, []);
});

test("a shared registration is not cascade-deleted by either user", async () => {
  const { DELETE, calls } = loadRoute({
    authorizationCodes: [
      { user_id: 6, used: true },
      { user_id: 7, used: false },
    ],
  });
  const response = await remove(DELETE);

  assert.equal(response.status, 404);
  assert.deepEqual(calls.revokedTokenUpserts, []);
  assert.deepEqual(calls.clientDeletes, []);
});

test("the persisted owner can remove a client after authorization-code cleanup", async () => {
  const { DELETE, calls } = loadRoute({ authorizationCodes: [] });
  const response = await remove(DELETE);

  assert.equal(response.status, 200);
  assert.equal(calls.committed.length, 3);
});

test("the owner revokes the selected client's tracked access token and registration", async () => {
  const { DELETE, calls } = loadRoute();
  const response = await remove(DELETE);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "Client removed",
  });
  assert.equal(calls.queries.length, 3);
  assert.ok(calls.queries.every(({ sql }) => sql.includes("FOR UPDATE")));
  assert.equal(calls.revokedTokenUpserts.length, 2);
  assert.deepEqual(calls.revokedTokenUpserts[0].where, {
    jti: "selected-client-access-token",
  });
  assert.equal(calls.revokedTokenUpserts[0].create.user_id, 6);
  assert.ok(calls.revokedTokenUpserts[0].create.revoked_at instanceof Date);
  assert.deepEqual(
    calls.revokedTokenUpserts[0].create.expires_at,
    new Date("2099-01-01T00:00:00.000Z"),
  );
  assert.deepEqual(calls.revokedTokenUpserts[1].where, {
    jti: "user:6:oauth:legacy",
  });
  assert.equal(calls.revokedTokenUpserts[1].create.user_id, 6);
  assert.deepEqual(
    calls.revokedTokenUpserts[1].create.expires_at,
    new Date("9999-12-31T23:59:59.999Z"),
  );
  assert.deepEqual(calls.clientDeletes, [
    { where: { client_id: "owned-client" } },
  ]);
  assert.equal(calls.committed.length, 3);
});

test("a failed delete rolls the revocation back and returns an error", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const { DELETE, calls } = loadRoute({
      deleteError: new Error("database unavailable"),
    });
    const response = await remove(DELETE);

    assert.equal(response.status, 500);
    assert.equal(calls.rolledBack, 1);
    assert.deepEqual(calls.committed, []);
  } finally {
    console.error = originalError;
  }
});

test("serialization failures retry the complete removal transaction", async () => {
  const retry = Object.assign(new Error("retry"), { code: "P2034" });
  const { DELETE, calls } = loadRoute({ transactionErrors: [retry] });
  const response = await remove(DELETE);

  assert.equal(response.status, 200);
  assert.equal(calls.transactions, 2);
  assert.equal(calls.committed.length, 3);
});

async function withClientLifecycle(check) {
  const { load } = require('./task-route-loader.cjs');
  const jwt = require('jsonwebtoken');
  const previous = { JWT_SECRET: process.env.JWT_SECRET, JWT_ISSUER: process.env.JWT_ISSUER };
  process.env.JWT_SECRET = 'fixture-client-lifecycle-signing-key';
  process.env.JWT_ISSUER = 'fixture-client-lifecycle';
  try {
    const h = loadRoute();
    const user = { id: 6, email: 'fixture@example.test', mcpTokensRevokedAt: null };
    const store = {
      user: { findUnique: async () => user },
      oAuthClient: { findUnique: async () =>
        h.calls.committed.some(([kind]) => kind === 'client') ? null : { client_id: 'owned-client' } },
      revokedToken: { findFirst: async ({ where }) =>
        h.calls.committed.find(([kind, args]) => kind === 'revokedToken' && where.jti.in.includes(args.where.jti))?.[1].create ?? null },
    };
    const mocks = {
      '@/lib/prisma': { default: store },
      '@/utils/controllers/logs/createLog': { default: async () => {} },
      '@/lib/flags': {},
      '@/lib/mcp/managementKeyTeamScope': {},
    };
    const verifier = load('src/lib/mcp/auth/verifyJwt.ts', mocks);
    const errors = load('src/lib/mcp/auth/mcpAuthErrors.ts', {
      ...mocks,
      './verifyJwt': verifier,
      './session': {},
      '@/lib/mcp/managementPermissions': {},
    });
    const { handleMcpTokenRefresh } = load('src/lib/mcp/token/refresh.ts', {
      ...mocks, '@/lib/mcp/auth': { ...verifier, ...errors },
    });
    const issued = [];
    const claimed = [];
    const refreshed = [];
    const token = jwt.sign({ userId: user.id, client_id: 'owned-client', jti: 'selected-client-access-token' },
      process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER, audience: 'http://localhost:3001', expiresIn: '1h' });
    const accountToken = jwt.sign({ userId: user.id, jti: 'fixture-account-jti' },
      process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER, audience: 'mcp-api', expiresIn: '1h' });
    const replacementToken = jwt.sign({ userId: user.id, jti: 'fixture-account-replacement-jti' },
      process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER, audience: 'mcp-api', expiresIn: '1h' });
    const refresh = (presented) => handleMcpTokenRefresh(new NextRequest('https://app.hypertask.ai/api/mcp/token/refresh', {
      method: 'POST', headers: { Authorization: `Bearer ${presented}` },
    }), {
      validateAuth: () => verifier.validateJwtToken(presented),
      verifyToken: verifier.verifyMcpJwtToken,
      findAgent: async () => null,
      createToken: (...args) => { issued.push(args); return replacementToken; },
      claimRotation: async (...args) => { claimed.push(args); return true; },
      createAuditLog: async (...args) => { refreshed.push(args); },
    });
    await check({ ...h, verifier, token, accountToken, replacementToken, refresh, issued, claimed, refreshed });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('removed OAuth clients have no account-token refresh result', async () => {
  await withClientLifecycle(async ({ DELETE, verifier, token, refresh, issued, claimed, refreshed }) => {
    assert.ok(await verifier.validateJwtToken(token));
    const before = await refresh(token);
    assert.equal(before.status, 401);
    assert.equal((await before.json()).reason, 'invalid_token');
    assert.equal((await remove(DELETE)).status, 200);
    assert.equal(await verifier.validateJwtToken(token), null);
    const after = await refresh(token);
    assert.equal(after.status, 401);
    assert.equal((await after.json()).reason, 'invalid_token');
    assert.deepEqual(issued, []);
    assert.deepEqual(claimed, []);
    assert.deepEqual(refreshed, []);
  });
});

test('registered OAuth clients keep MCP access and account tokens keep refresh', async () => {
  await withClientLifecycle(async ({ verifier, token, accountToken, replacementToken, refresh, issued, claimed, refreshed }) => {
    assert.equal((await verifier.validateJwtToken(token)).user.id, 6);
    const response = await refresh(accountToken);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).token, replacementToken);
    assert.deepEqual(issued, [[6, 'fixture@example.test', '30d']]);
    assert.equal(claimed.length, 1);
    assert.equal(refreshed.length, 1);
  });
});
