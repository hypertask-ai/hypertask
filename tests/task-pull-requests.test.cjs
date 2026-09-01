const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

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
  linkTaskPullRequest,
  PullRequestLinkError,
} = jiti(path.join(root, "src/lib/pullRequests/taskPullRequests.ts"));

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

const githubMetadata = {
  repositoryId: "1",
  pullRequestId: "110",
  title: "HTPR-5899 linked PR property",
  lifecycle: "open",
  headSha: "abc123",
  sourceUpdatedAt: new Date("2026-09-01T12:00:00Z"),
};

function fakeLinkDb({ authorized = true, existing = null } = {}) {
  const calls = { pullRequestCreates: [], activities: [], taskWhere: null };
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    taskLease: { deleteMany: async () => ({ count: 0 }) },
    task: {
      findFirst: async ({ where }) => {
        calls.taskWhere = where;
        return authorized ? { id: 36202, updatedByUserIds: [] } : null;
      },
      update: async () => ({ id: 36202 }),
    },
    taskPullRequest: {
      findUnique: async () => existing,
      create: async ({ data }) => {
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

function loadBrowserLinkRoute(verifySession) {
  const filename = path.join(root, "src/pages/api/tasks/linkPullRequest.ts");
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const linkCalls = [];
  const broadcastCalls = [];
  const loadedModule = { exports: {} };
  const stubs = {
    "@/lib/auth/session": {
      SESSION_COOKIE: "ht_session",
      verifySession,
    },
    "@/lib/pullRequests/taskPullRequests": {
      PullRequestLinkError,
      linkTaskPullRequest: async (input) => {
        linkCalls.push(input);
        return { created: false, pullRequest: { id: "linked-pr-id" } };
      },
    },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
    },
    "@/lib/realtime/server": {
      broadcastTaskChange: async (...args) => broadcastCalls.push(args),
    },
  };
  new Function("module", "exports", "require", javascript)(
    loadedModule,
    loadedModule.exports,
    (request) => stubs[request] ?? require(request),
  );
  return {
    handler: loadedModule.exports.default,
    linkCalls,
    broadcastCalls,
  };
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
      body: { taskId: 36202, url: githubMetadata.url },
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
  assert.deepEqual(broadcastCalls, [
    [36202, { originUserId: 6 }],
  ]);
});
