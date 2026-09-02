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
  authorizationCodes = [{ user_id: 6, used: true }],
  refreshTokens = [{ userId: 6 }],
  deleteError = null,
  transactionErrors = [],
} = {}) {
  const calls = {
    queries: [],
    userUpdates: [],
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
          calls.queries.push({ sql: strings.join("?"), values });
          queryIndex += 1;
          if (queryIndex === 1) {
            return clientExists ? [{ client_id: values[0] }] : [];
          }
          if (queryIndex === 2) return authorizationCodes;
          if (queryIndex === 3) return refreshTokens;
          throw new Error("Unexpected query");
        },
        user: {
          update: async (args) => {
            calls.userUpdates.push(args);
            staged.push(["user", args]);
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

test("a different user cannot remove an OAuth client or learn whether it exists", async () => {
  const { DELETE, calls } = loadRoute({
    sessionUserId: 7,
    authorizationCodes: [{ user_id: 6, used: true }],
  });
  const response = await remove(DELETE);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Client not found",
  });
  assert.deepEqual(calls.userUpdates, []);
  assert.deepEqual(calls.clientDeletes, []);
  assert.deepEqual(calls.committed, []);
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
  assert.deepEqual(calls.userUpdates, []);
  assert.deepEqual(calls.clientDeletes, []);
});

test("the owner revokes account credentials and deletes the locked registration", async () => {
  const { DELETE, calls } = loadRoute();
  const response = await remove(DELETE);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "Client removed",
  });
  assert.equal(calls.queries.length, 3);
  assert.ok(calls.queries.every(({ sql }) => sql.includes("FOR UPDATE")));
  assert.equal(calls.userUpdates.length, 1);
  assert.deepEqual(calls.userUpdates[0].where, { id: 6 });
  assert.ok(calls.userUpdates[0].data.mcpTokensRevokedAt instanceof Date);
  assert.deepEqual(calls.clientDeletes, [
    { where: { client_id: "owned-client" } },
  ]);
  assert.equal(calls.committed.length, 2);
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
  assert.equal(calls.committed.length, 2);
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
  const removeHandler = hook.slice(
    hook.indexOf("const handleRemove"),
    hook.indexOf("const handleRevokeAll"),
  );

  assert.match(section, /<ConfirmDialog/);
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
