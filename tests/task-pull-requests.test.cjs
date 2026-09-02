const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Prisma } = require("@prisma/client");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  boardForGithubRepository,
  checkStateFromSuites,
  derivePullRequestDisplayState,
  isStaleCheckSuiteObservation,
  parseGithubPullRequestUrl,
} = jiti(path.join(root, "src/lib/pullRequests/githubPullRequests.ts"));
const {
  fetchGithubPullRequest,
  linkTaskPullRequest,
  PullRequestLinkError,
} = jiti(path.join(root, "src/lib/pullRequests/taskPullRequests.ts"));
const { createLinkPullRequestHandler } = jiti(
  path.join(root, "src/pages/api/tasks/linkPullRequest.ts"),
);

test("parseGithubPullRequestUrl accepts only canonical GitHub pull request URLs", () => {
  assert.deepEqual(
    parseGithubPullRequestUrl("https://github.com/Hypertask-AI/Hypertask/pull/110"),
    {
      owner: "hypertask-ai",
      repository: "hypertask",
      number: 110,
      url: "https://github.com/hypertask-ai/hypertask/pull/110",
    },
  );
  assert.deepEqual(
    parseGithubPullRequestUrl("https://github.com/acme/app/pull/42/"),
    {
      owner: "acme",
      repository: "app",
      number: 42,
      url: "https://github.com/acme/app/pull/42",
    },
  );

  for (const value of [
    "http://github.com/acme/app/pull/42",
    "https://github.example/acme/app/pull/42",
    "https://github.com/acme/app/issues/42",
    "https://github.com/acme/app/pull/0",
    "https://github.com/acme/app/pull/42/files",
    "https://user@github.com/acme/app/pull/42",
  ]) {
    assert.equal(parseGithubPullRequestUrl(value), null, value);
  }
});

test("derivePullRequestDisplayState preserves the four approved states", () => {
  assert.equal(derivePullRequestDisplayState("merged", "failing"), "merged");
  assert.equal(derivePullRequestDisplayState("closed", "passing"), "checks_red");
  assert.equal(derivePullRequestDisplayState("open", "failing"), "checks_red");
  assert.equal(derivePullRequestDisplayState("open", "passing"), "green");
  assert.equal(derivePullRequestDisplayState("open", "pending"), "open");
  assert.equal(derivePullRequestDisplayState("open", null), "open");
});

test("checkStateFromSuites aggregates current GitHub App observations", () => {
  assert.equal(checkStateFromSuites([]), "pending");
  assert.equal(
    checkStateFromSuites([
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "neutral" },
    ]),
    "passing",
  );
  assert.equal(
    checkStateFromSuites([
      { status: "completed", conclusion: "success" },
      { status: "in_progress", conclusion: null },
    ]),
    "pending",
  );
  assert.equal(
    checkStateFromSuites([
      { status: "queued", conclusion: null },
      { status: "completed", conclusion: "failure" },
    ]),
    "failing",
  );
});

test("check suite observations reset per pull request head", () => {
  const oldHeadObservation = {
    headSha: "old-head",
    sourceUpdatedAt: new Date("2026-09-01T12:05:00Z"),
  };
  assert.equal(
    isStaleCheckSuiteObservation(oldHeadObservation, {
      headSha: "old-head",
      sourceUpdatedAt: new Date("2026-09-01T12:04:00Z"),
    }),
    true,
  );
  assert.equal(
    isStaleCheckSuiteObservation(oldHeadObservation, {
      headSha: "new-head",
      sourceUpdatedAt: new Date("2026-09-01T12:04:00Z"),
    }),
    false,
  );
});

test("GitHub webhook repository policy cannot target another board", () => {
  const publicRepository = (fullName) => ({
    fullName,
    isPrivate: false,
    isFork: false,
  });
  assert.equal(
    boardForGithubRepository(publicRepository("hypertask-ai/hypertask")),
    15,
  );
  assert.equal(
    boardForGithubRepository(publicRepository("HYPERTASK-AI/CLI")),
    15,
  );
  assert.equal(
    boardForGithubRepository(publicRepository("fork-owner/hypertask")),
    null,
  );
  assert.equal(
    boardForGithubRepository({
      ...publicRepository("hypertask-ai/hypertask"),
      isPrivate: true,
    }),
    null,
  );
  assert.equal(
    boardForGithubRepository({
      ...publicRepository("hypertask-ai/hypertask"),
      isFork: true,
    }),
    null,
  );
});

const canonicalPullRequestUrl =
  "https://github.com/hypertask-ai/hypertask/pull/110";
const githubMetadata = {
  repositoryId: "1",
  pullRequestId: "110",
  title: "HTPR-5899 linked PR property",
  lifecycle: "open",
  headSha: "abc123",
  sourceUpdatedAt: new Date("2026-09-01T12:00:00Z"),
};

async function withMockFetch(mock, callback) {
  const originalFetch = global.fetch;
  global.fetch = mock;
  try {
    await callback();
  } finally {
    global.fetch = originalFetch;
  }
}

test("fetchGithubPullRequest normalizes network failures", async () => {
  const parsed = parseGithubPullRequestUrl(canonicalPullRequestUrl);
  await withMockFetch(
    async () => {
      throw new Error("network unavailable");
    },
    async () => {
      await assert.rejects(
        fetchGithubPullRequest(parsed),
        (error) =>
          error instanceof PullRequestLinkError &&
          error.status === 502 &&
          error.code === "github_unavailable",
      );
    },
  );
});

test("fetchGithubPullRequest rejects malformed GitHub JSON", async () => {
  const parsed = parseGithubPullRequestUrl(canonicalPullRequestUrl);
  await withMockFetch(
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("invalid JSON");
      },
    }),
    async () => {
      await assert.rejects(
        fetchGithubPullRequest(parsed),
        (error) =>
          error instanceof PullRequestLinkError &&
          error.status === 502 &&
          error.code === "invalid_github_response",
      );
    },
  );
});

function fakeLinkDb({
  authorized = true,
  existing = null,
  globalExisting = null,
  createError = null,
  updatedByUserIds = [],
} = {}) {
  const calls = {
    pullRequestCreates: [],
    activities: [],
    taskUpdates: [],
    taskWhere: null,
  };
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    taskLease: { deleteMany: async () => ({ count: 0 }) },
    task: {
      findFirst: async ({ where }) => {
        calls.taskWhere = where;
        return authorized ? { id: 36202, updatedByUserIds } : null;
      },
      update: async (input) => {
        calls.taskUpdates.push(input);
        return { id: 36202 };
      },
    },
    taskPullRequest: {
      findUnique: async ({ where }) =>
        where.repositoryOwner_repositoryName_number
          ? globalExisting
          : existing,
      create: async ({ data }) => {
        if (createError) throw createError;
        calls.pullRequestCreates.push(data);
        return {
          id: "linked-pr-id",
          repositoryOwner: data.repositoryOwner,
          repositoryName: data.repositoryName,
          number: data.number,
          url: data.url,
          title: data.title,
          lifecycle: data.lifecycle,
          checkState: data.checkState,
          headSha: data.headSha,
          updatedAt: new Date("2026-09-01T12:00:01Z"),
        };
      },
    },
    user: {
      findUnique: async () => ({
        id: 6,
        displayName: "Valentin Yeo",
        photoURL: null,
        email: "owner@example.test",
      }),
    },
    agent: { findFirst: async () => null },
    comment: {
      create: async ({ data }) => {
        calls.activities.push(data);
        return data;
      },
    },
  };
  return {
    calls,
    db: {
      $transaction: async (callback) => callback(tx),
      task: tx.task,
      taskPullRequest: tx.taskPullRequest,
    },
  };
}

test("linkTaskPullRequest authorizes the task and writes one durable activity", async () => {
  const { db, calls } = fakeLinkDb();
  const result = await linkTaskPullRequest({
    taskId: 36202,
    userId: 6,
    url: "https://github.com/hypertask-ai/hypertask/pull/110",
    fetchMetadata: async () => githubMetadata,
    db,
  });

  assert.equal(result.created, true);
  assert.equal(result.pullRequest.displayState, "open");
  assert.equal(calls.taskWhere.project.OR.length > 0, true);
  assert.equal(calls.pullRequestCreates.length, 1);
  assert.equal(calls.activities.length, 1);
  assert.equal(calls.activities[0].activity.type, "TaskPullRequest");
  assert.equal(calls.activities[0].activity.data.action, "linked");
});

test("linkTaskPullRequest updates the task timestamp for a repeated user", async () => {
  const { db, calls } = fakeLinkDb({ updatedByUserIds: [6] });
  const result = await linkTaskPullRequest({
    taskId: 36202,
    userId: 6,
    url: canonicalPullRequestUrl,
    fetchMetadata: async () => githubMetadata,
    db,
  });

  assert.equal(result.created, true);
  assert.equal(calls.taskUpdates.length, 1);
  assert.equal(calls.taskUpdates[0].data.updatedAt instanceof Date, true);
  assert.equal("updatedByUserIds" in calls.taskUpdates[0].data, false);
});

test("linkTaskPullRequest rejects an inaccessible task without writing", async () => {
  const { db, calls } = fakeLinkDb({ authorized: false });
  await assert.rejects(
    linkTaskPullRequest({
      taskId: 36202,
      userId: 999,
      url: "https://github.com/hypertask-ai/hypertask/pull/110",
      fetchMetadata: async () => githubMetadata,
      db,
    }),
    (error) =>
      error instanceof PullRequestLinkError &&
      error.status === 404 &&
      error.code === "task_not_found",
  );
  assert.equal(calls.pullRequestCreates.length, 0);
  assert.equal(calls.activities.length, 0);
});

test("linkTaskPullRequest rejects a pull request already linked to another task", async () => {
  const createError = new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "7.9.1",
  });
  const { db, calls } = fakeLinkDb({
    globalExisting: { id: "linked-elsewhere" },
    createError,
  });
  await assert.rejects(
    linkTaskPullRequest({
      taskId: 36202,
      userId: 6,
      url: canonicalPullRequestUrl,
      fetchMetadata: async () => githubMetadata,
      db,
    }),
    (error) =>
      error instanceof PullRequestLinkError &&
      error.status === 409 &&
      error.code === "pr_already_linked",
  );
  assert.equal(calls.pullRequestCreates.length, 0);
});

test("linkTaskPullRequest is idempotent and does not duplicate activity", async () => {
  const existing = {
    id: "linked-pr-id",
    repositoryOwner: "hypertask-ai",
    repositoryName: "hypertask",
    number: 110,
    url: "https://github.com/hypertask-ai/hypertask/pull/110",
    title: githubMetadata.title,
    lifecycle: "open",
    checkState: "pending",
    headSha: "abc123",
    updatedAt: new Date("2026-09-01T12:00:01Z"),
  };
  const { db, calls } = fakeLinkDb({ existing });
  const result = await linkTaskPullRequest({
    taskId: 36202,
    userId: 6,
    url: existing.url,
    fetchMetadata: async () => githubMetadata,
    db,
  });

  assert.equal(result.created, false);
  assert.equal(calls.pullRequestCreates.length, 0);
  assert.equal(calls.activities.length, 0);
});

function loadBrowserLinkRoute(verifySession, { broadcastError = null } = {}) {
  const linkCalls = [];
  const broadcastCalls = [];
  const handler = createLinkPullRequestHandler({
    verifySession,
    linkTaskPullRequest: async (input) => {
      linkCalls.push(input);
      return { created: false, pullRequest: { id: "linked-pr-id" } };
    },
    broadcastTaskChange: async (...args) => {
      broadcastCalls.push(args);
      if (broadcastError) throw broadcastError;
    },
  });
  return { handler, linkCalls, broadcastCalls };
}

function responseRecorder() {
  const result = { status: null, body: null };
  const response = {
    status(status) {
      result.status = status;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
  };
  return { response, result };
}

test("browser linking rejects an unsigned profile cookie", async () => {
  const { handler, linkCalls } = loadBrowserLinkRoute(() => null);
  const { response, result } = responseRecorder();
  await handler(
    {
      method: "POST",
      cookies: { nookies_user: JSON.stringify({ id: 999 }) },
      body: { taskId: 36202, url: canonicalPullRequestUrl },
    },
    response,
  );

  assert.equal(result.status, 401);
  assert.deepEqual(linkCalls, []);
});

test("browser linking uses only the signed session identity", async () => {
  const { handler, linkCalls, broadcastCalls } = loadBrowserLinkRoute((token) =>
    token === "signed" ? { id: 6 } : null,
  );
  const { response, result } = responseRecorder();
  const url = "https://github.com/hypertask-ai/hypertask/pull/110";
  await handler(
    {
      method: "POST",
      cookies: {
        ht_session: "signed",
        nookies_user: JSON.stringify({ id: 999 }),
      },
      body: { taskId: 36202, url },
    },
    response,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(linkCalls, [{ taskId: 36202, userId: 6, url }]);
  assert.deepEqual(broadcastCalls, [[36202, { originUserId: 6 }]]);
});

test("webhook does not fall back to an unrelated ticket when the pull request is linked elsewhere", async () => {
  const prismaPath = path.join(root, "src/lib/prisma.ts");
  const syncPath = path.join(
    root,
    "src/lib/pullRequests/syncTaskPullRequests.ts",
  );
  const previousPrisma = require.cache[prismaPath];
  const previousSync = require.cache[syncPath];
  let taskFallbackLookups = 0;
  const prisma = {
    $transaction: async (callback) =>
      callback({
        taskPullRequest: {
          findMany: async () => [],
          findUnique: async ({ where }) =>
            where.repositoryOwner_repositoryName_number
              ? { id: "linked-on-another-board" }
              : null,
        },
        task: {
          findFirst: async () => {
            taskFallbackLookups += 1;
            return { id: 36202 };
          },
        },
      }),
  };
  delete require.cache[prismaPath];
  delete require.cache[syncPath];
  require.cache[prismaPath] = {
    id: prismaPath,
    filename: prismaPath,
    loaded: true,
    exports: { default: prisma },
  };

  try {
    const syncPullRequestFromWebhook = jiti(syncPath, { cache: false })
      .syncPullRequestFromWebhook;
    const result = await syncPullRequestFromWebhook({
      boardId: 15,
      ticketNumber: "HTPR-5899",
      repositoryOwner: "hypertask-ai",
      repositoryName: "hypertask",
      repositoryId: "1",
      pullRequestId: "110",
      number: 110,
      url: canonicalPullRequestUrl,
      title: "HTPR-5899 linked PR property",
      lifecycle: "open",
      headSha: "abc123",
      sourceUpdatedAt: new Date("2026-09-01T12:00:00Z"),
      action: "opened",
      actorUserId: 6,
    });

    assert.deepEqual(result, { linked: 0, updated: 0, taskIds: [] });
    assert.equal(taskFallbackLookups, 0);
  } finally {
    if (previousPrisma) require.cache[prismaPath] = previousPrisma;
    else delete require.cache[prismaPath];
    if (previousSync) require.cache[syncPath] = previousSync;
    else delete require.cache[syncPath];
  }
});

test("webhook does not return a fallback task after a concurrent global link wins", async () => {
  const prismaPath = path.join(root, "src/lib/prisma.ts");
  const syncPath = path.join(
    root,
    "src/lib/pullRequests/syncTaskPullRequests.ts",
  );
  const previousPrisma = require.cache[prismaPath];
  const previousSync = require.cache[syncPath];
  let taskFallbackLookups = 0;
  const prisma = {
    $transaction: async (callback) =>
      callback({
        taskPullRequest: {
          findMany: async () => [],
          findUnique: async () => null,
          createMany: async () => ({ count: 0 }),
        },
        task: {
          findFirst: async () => {
            taskFallbackLookups += 1;
            return { id: 36202 };
          },
        },
        $queryRaw: async () => [],
        user: { findUnique: async () => null },
      }),
  };
  delete require.cache[prismaPath];
  delete require.cache[syncPath];
  require.cache[prismaPath] = {
    id: prismaPath,
    filename: prismaPath,
    loaded: true,
    exports: { default: prisma },
  };

  try {
    const syncPullRequestFromWebhook = jiti(syncPath, { cache: false })
      .syncPullRequestFromWebhook;
    const result = await syncPullRequestFromWebhook({
      boardId: 15,
      ticketNumber: "HTPR-5899",
      repositoryOwner: "hypertask-ai",
      repositoryName: "hypertask",
      repositoryId: "1",
      pullRequestId: "110",
      number: 110,
      url: canonicalPullRequestUrl,
      title: "HTPR-5899 linked PR property",
      lifecycle: "open",
      headSha: "abc123",
      sourceUpdatedAt: new Date("2026-09-01T12:00:00Z"),
      action: "opened",
      actorUserId: 6,
    });

    assert.deepEqual(result, { linked: 0, updated: 0, taskIds: [] });
    assert.equal(taskFallbackLookups, 1);
  } finally {
    if (previousPrisma) require.cache[prismaPath] = previousPrisma;
    else delete require.cache[prismaPath];
    if (previousSync) require.cache[syncPath] = previousSync;
    else delete require.cache[syncPath];
  }
});

test("browser linking succeeds when realtime delivery fails", async () => {
  const warning = console.warn;
  console.warn = () => {};
  try {
    const { handler } = loadBrowserLinkRoute(() => ({ id: 6 }), {
      broadcastError: new Error("realtime unavailable"),
    });
    const { response, result } = responseRecorder();
    await handler(
      {
        method: "POST",
        cookies: { ht_session: "signed" },
        body: { taskId: 36202, url: canonicalPullRequestUrl },
      },
      response,
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.created, false);
  } finally {
    console.warn = warning;
  }
});
