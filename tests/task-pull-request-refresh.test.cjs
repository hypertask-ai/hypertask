const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const now = new Date("2026-10-02T12:00:00Z");
const row = {
  id: "cli-pr-81",
  repositoryOwner: "hypertask-ai",
  repositoryName: "cli",
  number: 81,
  url: "https://github.com/hypertask-ai/cli/pull/81",
  title: "Claim leases for task updates",
  lifecycle: "open",
  checkState: "pending",
  headSha: "old-head",
  updatedAt: new Date("2026-09-18T16:51:34.613Z"),
};
const metadata = {
  repositoryId: "123",
  pullRequestId: "456",
  title: row.title,
  lifecycle: "merged",
  headSha: "merged-head",
  sourceUpdatedAt: new Date("2026-09-18T16:55:04Z"),
};
const calls = { writes: [], reads: [], fetches: [], broadcasts: [] };
const scheduled = [];
const functionsPath = require.resolve("@vercel/functions");
require.cache[functionsPath] = {
  id: functionsPath, filename: functionsPath, loaded: true,
  exports: { waitUntil: (promise) => scheduled.push(promise) },
};
const realtimePath = path.join(root, "src/lib/realtime/server.ts");
require.cache[realtimePath] = {
  id: realtimePath, filename: realtimePath, loaded: true,
  exports: { broadcastTaskChange: async (taskId) => calls.broadcasts.push(taskId) },
};
let task = null;
let current = row;
let updateCount = 1;
const db = {
  featureFlag: { findUnique: async () => ({ mode: "OFF" }) },
  task: {
    findFirst: async (input) => {
      calls.reads.push(input);
      return task;
    },
  },
  taskPullRequest: {
    updateMany: async (input) => {
      calls.writes.push(input);
      return { count: updateCount };
    },
    findUnique: async () => current,
  },
};
// Mock the database boundary before loading production modules; these tests
// never connect to a database or mutate real tickets.
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { default: db },
};
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { refreshTaskPullRequests, toPublicTaskPullRequest } = jiti(
  path.join(root, "src/lib/pullRequests/taskPullRequests.ts"),
);
const { fetchTaskDetail } = jiti(
  path.join(root, "src/utils/controllers/taskDetail/load.ts"),
);

function options(fetchMetadata = async (parsed) => {
  calls.fetches.push(parsed);
  return metadata;
}) {
  return { db, now, fetchMetadata };
}

test.beforeEach(() => {
  calls.writes.length = calls.reads.length = calls.fetches.length = calls.broadcasts.length = 0;
  scheduled.length = 0;
  task = null;
  current = row;
  updateCount = 1;
});

test("stale CLI PR #81 heals to Merged and persists its GitHub observation", async () => {
  const [refreshed] = await refreshTaskPullRequests(40660, [row], options());
  assert.equal(refreshed.lifecycle, "merged");
  assert.equal(toPublicTaskPullRequest(refreshed).displayState, "merged");
  assert.deepEqual(calls.fetches, [{
    owner: "hypertask-ai", repository: "cli", number: 81, url: row.url,
  }]);
  assert.equal(calls.writes.length, 1);
  const { where, data } = calls.writes[0];
  assert.equal(where.taskId, 40660);
  assert.equal(where.id, row.id);
  assert.deepEqual(where.updatedAt, row.updatedAt);
  assert.deepEqual(where.OR, [
    { sourceUpdatedAt: null },
    { sourceUpdatedAt: { lte: metadata.sourceUpdatedAt } },
  ]);
  assert.equal(data.lifecycle, "merged");
  assert.deepEqual(data.sourceUpdatedAt, metadata.sourceUpdatedAt);
  assert.deepEqual(data.updatedAt, now);
});

test("refresh is repository-agnostic, not limited to the app or a repo allow-list", async () => {
  for (const repository of ["hypertask", "docs", "android", "another-linked-repo"]) {
    const linked = { ...row, repositoryName: repository,
      url: `https://github.com/hypertask-ai/${repository}/pull/81` };
    const [refreshed] = await refreshTaskPullRequests(40660, [linked], options());
    assert.equal(refreshed.lifecycle, "merged");
    assert.equal(calls.fetches.at(-1).repository, repository);
  }
});

test("recent and already merged rows do not consume GitHub requests", async () => {
  const rows = [
    { ...row, updatedAt: new Date(now.getTime() - 59_000) },
    { ...row, lifecycle: "merged" },
  ];
  assert.deepEqual(await refreshTaskPullRequests(40660, rows, options()), rows);
  assert.deepEqual(calls.fetches, []);
  assert.deepEqual(calls.writes, []);
});

test("unchanged open observations are throttled, preserving current-head checks", async () => {
  const passing = { ...row, checkState: "passing" };
  const [refreshed] = await refreshTaskPullRequests(40660, [passing], options(async () => ({
    ...metadata, lifecycle: "open", headSha: row.headSha,
  })));
  assert.equal(refreshed.checkState, "passing");
  assert.deepEqual(refreshed.updatedAt, now);
  await refreshTaskPullRequests(40660, [refreshed], options());
  assert.equal(calls.writes.length, 1);
});

test("a changed PR head invalidates checks for the old head", async () => {
  const [refreshed] = await refreshTaskPullRequests(40660,
    [{ ...row, checkState: "passing" }], options(async () => ({
      ...metadata, lifecycle: "open",
    })));
  assert.equal(refreshed.checkState, "pending");
  assert.equal(toPublicTaskPullRequest(refreshed).displayState, "open");
});

test("closed and reopened GitHub lifecycles use the existing display rules", async () => {
  const [closed] = await refreshTaskPullRequests(40660, [row], options(async () => ({
    ...metadata, lifecycle: "closed",
  })));
  assert.equal(toPublicTaskPullRequest(closed).displayState, "checks_red");
  const [reopened] = await refreshTaskPullRequests(40660,
    [{ ...row, lifecycle: "closed" }], options(async () => ({
      ...metadata, lifecycle: "open",
    })));
  assert.equal(reopened.lifecycle, "open");
});

test("concurrent webhook/check updates win over the fetched snapshot", async () => {
  updateCount = 0;
  current = { ...row, lifecycle: "merged", updatedAt: now };
  const [refreshed] = await refreshTaskPullRequests(40660, [row], options(async () => ({
    ...metadata, lifecycle: "open",
  })));
  assert.deepEqual(refreshed, current);
  assert.equal(calls.writes.length, 1);
});

test("deleted links are not recreated after a refresh race", async () => {
  updateCount = 0;
  current = null;
  assert.deepEqual(await refreshTaskPullRequests(40660, [row], options()), [row]);
});

test("GitHub failure preserves the row and permits a later retry", async () => {
  const warning = console.warn;
  console.warn = () => {};
  try {
    const rows = await refreshTaskPullRequests(40660, [row], options(async () => {
      throw new Error("GitHub rate limited or unavailable");
    }));
    assert.deepEqual(rows, [row]);
    assert.deepEqual(calls.writes, []);
    const [retried] = await refreshTaskPullRequests(40660, rows, options());
    assert.equal(retried.lifecycle, "merged");
  } finally {
    console.warn = warning;
  }
});

test("invalid or mismatched stored URLs are never fetched", async () => {
  const rows = [
    { ...row, url: "https://evil.example/repos/cli/pulls/81" },
    { ...row, url: "https://github.com/hypertask-ai/hypertask/pull/81" },
    { ...row, number: 82 },
  ];
  assert.deepEqual(await refreshTaskPullRequests(40660, rows, options()), rows);
  assert.deepEqual(calls.fetches, []);
  assert.deepEqual(calls.writes, []);
});

test("task detail heals stale rows only after the authorized task lookup", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.fetches.push(url);
    assert.equal(calls.reads.length, 1);
    assert.equal(calls.reads[0].where.project.OR.find(branch => branch.ownerId !== undefined).ownerId, 6);
    assert.ok(init.signal, "GitHub refresh must have a bounded network timeout");
    return Response.json({
      id: 456, html_url: row.url, title: row.title, state: "closed",
      merged_at: "2026-09-18T16:55:04Z", updated_at: "2026-09-18T16:55:04Z",
      base: { repo: { id: 123 } }, head: { sha: "merged-head" },
    });
  };
  try {
    assert.equal(await fetchTaskDetail("project-15", "6806", 6), null);
    assert.deepEqual(calls.fetches, []);
    calls.reads.length = 0;
    task = { id: 40660, projectId: 15, agent: null, description_: null, pullRequests: [row] };
    const result = await fetchTaskDetail("project-15", "6806", 6);
    assert.equal(result.pullRequests[0].lifecycle, "open");
    assert.equal(scheduled.length, 1);
    await scheduled[0];
    assert.equal(calls.writes.length, 1);
    assert.deepEqual(calls.broadcasts, [40660]);
    assert.deepEqual(calls.fetches, ["https://api.github.com/repos/hypertask-ai/cli/pulls/81"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("task detail returns saved PR state and reactions while GitHub is still pending", async () => {
  const originalFetch = global.fetch;
  let releaseGithub;
  const github = new Promise((resolve) => { releaseGithub = resolve; });
  global.fetch = async () => {
    calls.fetches.push("github");
    return github;
  };
  const reactions = [{ emoji: "thumbsup", count: "1", unified: "1f44d", users: [] }];
  db.$queryRaw = async () => reactions;
  task = {
    id: 40660, projectId: 15, agent: null,
    description_: { id: "description-1", content: "Saved description" },
    pullRequests: [row],
  };
  const detail = fetchTaskDetail("project-15", "6806", 6);
  try {
    const result = await Promise.race([
      detail,
      new Promise((resolve) => setImmediate(() => resolve("blocked-on-github"))),
    ]);
    assert.notEqual(result, "blocked-on-github", "Task content must not await GitHub");
    assert.deepEqual(result.pullRequests, [row]);
    assert.deepEqual(result.description_.reactions, reactions);
    assert.equal(calls.fetches.length, 1);
    assert.equal(calls.writes.length, 0);
    assert.equal(scheduled.length, 1, "Serverless lifetime must cover the refresh");
  } finally {
    releaseGithub(Response.json({
      id: 456, html_url: row.url, title: row.title, state: "closed",
      merged_at: "2026-09-18T16:55:04Z", updated_at: "2026-09-18T16:55:04Z",
      base: { repo: { id: 123 } }, head: { sha: "merged-head" },
    }));
    await detail;
    await Promise.all(scheduled);
    delete db.$queryRaw;
    global.fetch = originalFetch;
  }
  assert.equal(calls.writes.length, 1);
  assert.deepEqual(calls.broadcasts, [40660]);
});

test("task detail does not broadcast unchanged PR observations or GitHub failures", async () => {
  const originalFetch = global.fetch;
  const warning = console.warn;
  console.warn = () => {};
  task = { id: 40660, projectId: 15, agent: null, description_: null, pullRequests: [row] };
  try {
    for (const unavailable of [false, true]) {
      global.fetch = async () => {
        if (unavailable) throw new Error("GitHub unavailable");
        return Response.json({
          id: 456, html_url: row.url, title: row.title, state: "open",
          merged_at: null, updated_at: "2026-09-18T16:55:04Z",
          base: { repo: { id: 123 } }, head: { sha: row.headSha },
        });
      };
      assert.deepEqual((await fetchTaskDetail("project-15", "6806", 6)).pullRequests, [row]);
      await Promise.all(scheduled);
      assert.deepEqual(calls.broadcasts, [], "No refetch loop for timestamp-only updates or failures");
    }
    assert.equal(calls.writes.length, 1);
  } finally {
    global.fetch = originalFetch;
    console.warn = warning;
  }
});

test("task detail with no PRs schedules no background work", async () => {
  task = { id: 40660, projectId: 15, agent: null, description_: null, pullRequests: [] };
  assert.deepEqual((await fetchTaskDetail("project-15", "6806", 6)).pullRequests, []);
  assert.deepEqual(scheduled, []);
});
