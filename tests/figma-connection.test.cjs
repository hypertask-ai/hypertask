const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const originalCipherSecret = process.env.BYOK_CIPHER_SECRET;
const originalFigmaClientId = process.env.FIGMA_CLIENT_ID;
const originalFigmaClientSecret = process.env.FIGMA_CLIENT_SECRET;
process.env.BYOK_CIPHER_SECRET = "figma-connection-test-secret";
process.env.FIGMA_CLIENT_ID = "figma-client";
process.env.FIGMA_CLIENT_SECRET = "figma-secret";

const root = path.resolve(__dirname, "..");
const originalFetch = global.fetch;
let rows;
let operationRows;
let onPendingOperationRead;
let transactionFailuresAfterAction;
let lockCalls;
let lockTail;
const currentRow = () => rows.get(6) ?? null;
const figmaConnectionStore = {
  findUnique: async ({ where }) => rows.get(where.userId) ?? null,
  upsert: async ({ where, create, update }) => {
    const next = {
      ...(rows.has(where.userId) ? update : create),
      updatedAt: new Date(),
    };
    rows.set(where.userId, next);
    return {
      figmaUserId: next.figmaUserId,
      figmaUserName: next.figmaUserName,
      updatedAt: next.updatedAt,
    };
  },
  update: async ({ where, data }) => {
    const next = { ...rows.get(where.userId), ...data, updatedAt: new Date() };
    rows.set(where.userId, next);
    return next;
  },
  delete: async ({ where }) => {
    const deleted = rows.get(where.userId);
    rows.delete(where.userId);
    return deleted;
  },
  deleteMany: async ({ where }) => {
    const count = rows.delete(where.userId) ? 1 : 0;
    return { count };
  },
};
const figmaConnectionOperationStore = {
  findUnique: async ({ where }) => {
    const operation = operationRows.get(where.userId) ?? null;
    if (operation?.pendingUntil) onPendingOperationRead?.();
    return operation;
  },
  upsert: async ({ where, create, update }) => {
    const next = operationRows.has(where.userId) ? update : create;
    operationRows.set(where.userId, next);
    return next;
  },
  update: async ({ where, data }) => {
    const next = { ...operationRows.get(where.userId), ...data };
    operationRows.set(where.userId, next);
    return next;
  },
  updateMany: async ({ where, data }) => {
    const current = operationRows.get(where.userId);
    if (!current || current.operationId !== where.operationId) return { count: 0 };
    operationRows.set(where.userId, { ...current, ...data });
    return { count: 1 };
  },
};
const prisma = {
  figmaConnection: figmaConnectionStore,
  figmaConnectionOperation: figmaConnectionOperationStore,
  $transaction: async (action) => {
    let releaseLock;
    let rowsBeforeTransaction;
    let operationsBeforeTransaction;
    const tx = {
      $executeRaw: async (query) => {
        assert.match(
          query.strings.join("?"),
          /pg_advisory_xact_lock\(\?::int, \?::int\)/,
        );
        const previous = lockTail;
        lockTail = new Promise((resolve) => {
          releaseLock = resolve;
        });
        await previous;
        rowsBeforeTransaction = new Map(rows);
        operationsBeforeTransaction = new Map(operationRows);
        lockCalls += 1;
      },
      figmaConnection: figmaConnectionStore,
      figmaConnectionOperation: figmaConnectionOperationStore,
    };
    try {
      const result = await action(tx);
      if (transactionFailuresAfterAction > 0) {
        transactionFailuresAfterAction -= 1;
        throw new Error("transaction commit failed");
      }
      return result;
    } catch (error) {
      rows = rowsBeforeTransaction;
      operationRows = operationsBeforeTransaction;
      throw error;
    } finally {
      releaseLock?.();
    }
  },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { __esModule: true, default: prisma },
};
const flagsPath = path.join(root, "src/lib/flags.ts");
require.cache[flagsPath] = {
  id: flagsPath,
  filename: flagsPath,
  loaded: true,
  exports: {
    FIGMA_CONNECT_FLAG: "htpr-6136-figma-connect",
    isFeatureEnabled: async () => true,
  },
};
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const connection = jiti(path.join(root, "src/lib/figma/connection.ts"));

test.beforeEach(() => {
  global.fetch = originalFetch;
  rows = new Map();
  operationRows = new Map();
  onPendingOperationRead = null;
  transactionFailuresAfterAction = 0;
  lockCalls = 0;
  lockTail = Promise.resolve();
});

test.after(() => {
  global.fetch = originalFetch;
  if (originalCipherSecret === undefined) delete process.env.BYOK_CIPHER_SECRET;
  else process.env.BYOK_CIPHER_SECRET = originalCipherSecret;
  if (originalFigmaClientId === undefined) delete process.env.FIGMA_CLIENT_ID;
  else process.env.FIGMA_CLIENT_ID = originalFigmaClientId;
  if (originalFigmaClientSecret === undefined) delete process.env.FIGMA_CLIENT_SECRET;
  else process.env.FIGMA_CLIENT_SECRET = originalFigmaClientSecret;
});

test("connection tokens are encrypted at rest and decrypted for their owner", async () => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "plain-access-token",
    refreshToken: "plain-refresh-token",
    expiresAt,
    userId: "figma-user",
    figmaUserName: "Valentin",
  }));

  assert.equal(lockCalls, 2);
  assert.notEqual(currentRow().encryptedAccessToken, "plain-access-token");
  assert.notEqual(currentRow().encryptedRefreshToken, "plain-refresh-token");
  assert.equal(await connection.getFigmaAccessToken(6), "plain-access-token");
});

test("persists an issued connection after a transaction commit failure without reissuing", async () => {
  let issueCalls = 0;
  const connected = await connection.connectFigmaUser(6, async () => {
    issueCalls += 1;
    transactionFailuresAfterAction = 1;
    return {
      accessToken: "plain-access-token",
      refreshToken: "plain-refresh-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: "figma-user",
      figmaUserName: "Valentin",
    };
  });

  assert.equal(connected.figmaUserId, "figma-user");
  assert.equal(await connection.getFigmaAccessToken(6), "plain-access-token");
  assert.equal(issueCalls, 1);
  assert.equal(lockCalls, 3);
});

test("connection reads and disconnects stay scoped to one Hypertask user", async () => {
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "owner-access",
    refreshToken: "owner-refresh",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    userId: "figma-user",
    figmaUserName: "Valentin",
  }));

  assert.equal(await connection.getFigmaAccessToken(7), null);
  assert.equal(await connection.getFigmaConnection(7), null);
  await connection.disconnectFigmaUser(7);
  assert.equal(await connection.getFigmaAccessToken(6), "owner-access");
});

test("expired access tokens refresh once through the durable lease", async () => {
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "expired-access",
    refreshToken: "refresh-token",
    expiresAt: new Date(0),
    userId: "figma-user",
    figmaUserName: null,
  }));
  let refreshCalls = 0;
  global.fetch = async (url, init) => {
    refreshCalls += 1;
    assert.equal(url, "https://api.figma.com/v1/oauth/refresh");
    assert.equal(init.body.get("refresh_token"), "refresh-token");
    return Response.json({ access_token: "fresh-access", expires_in: 3600 });
  };

  assert.equal(await connection.getFigmaAccessToken(6, 10_000), "fresh-access");
  assert.equal(refreshCalls, 1);
  assert.equal(lockCalls, 4);
  assert.notEqual(currentRow().encryptedAccessToken, "fresh-access");
});

test("a durable refresh lease prevents concurrent token rotation", async () => {
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "expired-access",
    refreshToken: "refresh-token",
    expiresAt: new Date(0),
    userId: "figma-user",
    figmaUserName: null,
  }));
  let signalRefreshStarted;
  const refreshStarted = new Promise((resolve) => {
    signalRefreshStarted = resolve;
  });
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  let refreshCalls = 0;
  global.fetch = async () => {
    refreshCalls += 1;
    signalRefreshStarted();
    await refreshGate;
    return Response.json({ access_token: "fresh-access", expires_in: 3600 });
  };

  const first = connection.getFigmaAccessToken(6, 10_000);
  await refreshStarted;
  let signalLeaseObserved;
  const leaseObserved = new Promise((resolve) => {
    signalLeaseObserved = resolve;
  });
  onPendingOperationRead = signalLeaseObserved;
  const overlapping = connection.getFigmaAccessToken(6, 10_000);
  await leaseObserved;
  assert.equal(refreshCalls, 1);
  releaseRefresh();
  assert.deepEqual(await Promise.all([first, overlapping]), [
    "fresh-access",
    "fresh-access",
  ]);
  assert.equal(lockCalls, 5);
});

test("persists a rotated token after a transaction commit failure without refreshing twice", async () => {
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "expired-access",
    refreshToken: "refresh-token",
    expiresAt: new Date(0),
    userId: "figma-user",
    figmaUserName: null,
  }));
  let refreshCalls = 0;
  global.fetch = async () => {
    refreshCalls += 1;
    transactionFailuresAfterAction = 1;
    return Response.json({
      access_token: "fresh-access",
      expires_in: 3600,
      refresh_token: "rotated-refresh",
    });
  };

  assert.equal(await connection.getFigmaAccessToken(6, 10_000), "fresh-access");
  assert.equal(await connection.getFigmaAccessToken(6, 10_000), "fresh-access");
  assert.equal(refreshCalls, 1);
  assert.equal(lockCalls, 5);
});

test("clears the refresh lease when persistence retries are exhausted", async () => {
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "expired-access",
    refreshToken: "refresh-token",
    expiresAt: new Date(0),
    userId: "figma-user",
    figmaUserName: null,
  }));
  global.fetch = async () => {
    transactionFailuresAfterAction = 2;
    return Response.json({
      access_token: "fresh-access",
      expires_in: 3600,
      refresh_token: "rotated-refresh",
    });
  };

  await assert.rejects(
    connection.getFigmaAccessToken(6, 10_000),
    /transaction commit failed/,
  );
  assert.equal(operationRows.get(6).pendingUntil, null);
  assert.equal(lockCalls, 6);
});

test("invalid refresh credentials remove the unusable local connection", async () => {
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "expired-access",
    refreshToken: "invalid-refresh",
    expiresAt: new Date(0),
    userId: "figma-user",
    figmaUserName: null,
  }));
  global.fetch = async () =>
    Response.json({ error: "invalid_grant" }, { status: 400 });

  assert.equal(await connection.getFigmaAccessToken(6, 10_000), null);
  assert.equal(currentRow(), null);
});

test("client authentication failures preserve the refresh token", async () => {
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "expired-access",
    refreshToken: "still-valid-refresh",
    expiresAt: new Date(0),
    userId: "figma-user",
    figmaUserName: null,
  }));
  global.fetch = async () =>
    Response.json({ error: "invalid_client" }, { status: 401 });

  await assert.rejects(
    connection.getFigmaAccessToken(6, 10_000),
    (error) =>
      error instanceof Error &&
      error.status === 401 &&
      error.oauthError === "invalid_client",
  );
  assert.notEqual(currentRow(), null);
});

test("disconnect supersedes an in-flight connect without token resurrection", async () => {
  let issueStarted;
  const started = new Promise((resolve) => {
    issueStarted = resolve;
  });
  let releaseIssue;
  const issueGate = new Promise((resolve) => {
    releaseIssue = resolve;
  });
  const connecting = connection.connectFigmaUser(6, async () => {
    issueStarted();
    await issueGate;
    return {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "figma-user",
      figmaUserName: null,
    };
  });
  await started;
  const disconnecting = connection.disconnectFigmaUser(6);
  await disconnecting;
  assert.equal(currentRow(), null);

  releaseIssue();
  assert.equal(await connecting, null);
  assert.equal(currentRow(), null);
  assert.equal(lockCalls, 3);
});

test("a refresh queue that keeps reclaiming the slot still gives up at the caller's deadline", async () => {
  await connection.connectFigmaUser(6, async () => ({
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    userId: "figma-user",
    figmaUserName: null,
  }));

  // The token is stale, so every entry into getFigmaAccessToken must refresh.
  const nowMs = Date.now();
  rows.set(6, { ...rows.get(6), expiresAt: new Date(nowMs) });

  // Stand in for a queue of workers: the slot lapses (so waitForPendingRefresh
  // recurses into getFigmaAccessToken) and is immediately reclaimed by the next
  // worker (so that recursion waits again). Without one shared deadline each
  // recursion started a fresh 60s budget and this never returned.
  let lapse = true;
  onPendingOperationRead = () => {
    operationRows.set(6, {
      operationId: "other-worker",
      pendingUntil: new Date(lapse ? nowMs - 1 : nowMs + 60_000),
    });
    lapse = !lapse;
  };
  operationRows.set(6, {
    operationId: "other-worker",
    pendingUntil: new Date(nowMs + 60_000),
  });

  const timer = new Promise((resolve) => setTimeout(resolve, 5_000, "hung"));
  const outcome = await Promise.race([
    connection
      .getFigmaAccessToken(6, nowMs, nowMs + 600)
      .then(() => "resolved", (error) => error.message),
    timer,
  ]);
  assert.equal(outcome, "Figma token refresh did not finish in time");
});
