const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  const migration = fs.readFileSync(
    path.join(
      root,
      "src/prisma/migrations/20260902210000_add_oauth_client_owner/migration.sql",
    ),
    "utf8",
  );
  const { DELETE, calls } = loadRoute({ ownerUserId: null });
  const response = await remove(DELETE);

  assert.doesNotMatch(migration, /OAuthAuthorizationCode|OAuthRefreshToken/);
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

test("Settings uses the approved Remove dialog and updates the list locally", () => {
  const section = fs.readFileSync(
    path.join(root, "src/components/Modals/Settings/McpSection.tsx"),
    "utf8",
  );
  const hook = fs.readFileSync(
    path.join(
      root,
      "src/components/Modals/McpToken/hooks/useMcpConnections.ts",
    ),
    "utf8",
  );
  const listRoute = fs.readFileSync(
    path.join(root, "src/app/api/connections/list/route.ts"),
    "utf8",
  );
  const removeHandler = hook.slice(
    hook.indexOf("const handleRemove"),
    hook.indexOf("const handleRevokeAll"),
  );

  assert.match(section, /<ConfirmDialog/);
  assert.match(section, /connection\.is_owner/);
  assert.match(listRoute, /is_owner: client\.owner_id === user\.id/);
  assert.match(section, /icon=\{Trash2\}/);
  assert.match(section, /confirmLabel="Remove client"/);
  assert.match(
    section,
    /It disconnects now and must register again before it can reconnect\./,
  );
  assert.match(section, /\? "Removing"\s*: "Remove"/);
  assert.match(removeHandler, /method: "DELETE"/);
  assert.match(removeHandler, /current\.filter/);
  assert.match(removeHandler, /toast\.success\("Client removed"\)/);
  assert.doesNotMatch(removeHandler, /fetchConnections\(/);
});
