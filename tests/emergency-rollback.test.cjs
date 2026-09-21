// Production smoke calls this after a confirmed application failure. If the
// durable revert skips a real rollback opportunity, or the optional Vercel
// promote targets an unproven deployment, production stays broken.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const scriptUrl = pathToFileURL(
  path.join(root, ".github/scripts/emergency-rollback.mjs"),
).href;

const FAILING_SHA = "deadbeef00000000000000000000000000000000";
const OLDER_SHA = "1111111111111111111111111111111111111111";
const OTHER_SHA = "2222222222222222222222222222222222222222";

function projectBody(liveId, liveSha, liveCreated) {
  return {
    id: "prj_test",
    targets: {
      production: { id: liveId, meta: { githubCommitSha: liveSha }, createdAt: liveCreated },
    },
  };
}

function deploymentsBody(entries) {
  return { deployments: entries };
}

// Sequenced fetch stub: for a given URL prefix, each call consumes the next
// entry in that prefix's queue (repeating the last one once exhausted), so a
// test can make the recheck call return something different from the first
// check.
function makeFetch(queues) {
  const calls = [];
  const cursors = {};
  const fetchImpl = async (url, opts = {}) => {
    calls.push({
      url,
      method: opts.method || "GET",
      body: opts.body ? JSON.parse(opts.body) : undefined,
    });
    const prefix = Object.keys(queues).find((p) => url.startsWith(p));
    if (!prefix) throw new Error(`unexpected fetch ${url}`);
    const queue = queues[prefix];
    const i = cursors[prefix] ?? 0;
    const entry = queue[Math.min(i, queue.length - 1)];
    cursors[prefix] = i + 1;
    if (entry.throw) throw entry.throw;
    return { ok: entry.status < 400, status: entry.status, json: async () => entry.body };
  };
  return { fetchImpl, calls };
}

async function rollback(failingSha, queues, delayImpl = async () => {}) {
  const { promotePreviousDeployment } = await import(scriptUrl);
  const { fetchImpl, calls } = makeFetch({
    ...queues,
    "https://api.github.com/repos/test/repo/actions/workflows/prod-health.yml/runs": [
      {
        status: 200,
        body: {
          workflow_runs: [
            { status: "completed", conclusion: "success", updated_at: "2026-09-20T12:00:00Z" },
          ],
        },
      },
    ],
  });
  const result = await promotePreviousDeployment(
    failingSha,
    "test-token",
    fetchImpl,
    delayImpl,
    { repository: "test/repo", githubToken: "github-token" },
  );
  return { result, calls };
}

test("production already moved on to a different commit -> skip", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", OTHER_SHA, 2000) },
    ],
  });
  assert.equal(result.action, "skip");
  assert.match(result.reason, /already moved on/);
  // Never gets far enough to list deployments or promote.
  assert.equal(calls.length, 1);
});

test("no qualifying older deployment -> skip", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      {
        status: 200,
        body: deploymentsBody([
          // Same sha as the failing commit: disqualified even though older.
          { uid: "dpl_dup", state: "READY", meta: { githubCommitSha: FAILING_SHA }, created: 1000 },
          // Newer than live: disqualified regardless of sha.
          { uid: "dpl_newer", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 3000 },
        ]),
      },
    ],
  });
  assert.equal(result.action, "skip");
  assert.match(result.reason, /no older READY deployment/);
  assert.equal(calls.some((c) => c.method === "POST"), false);
});

test("deployment-list HTTP failure -> failed, not skip", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      { status: 503, body: {} },
    ],
  });
  assert.equal(result.action, "failed");
  assert.equal(result.reason, "deployment list failed: HTTP 503");
  assert.equal(calls.some((c) => c.method === "POST"), false);
});

test("live deployment changes between check and promote -> skip, no POST issued", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) }, // initial check
      { status: 200, body: projectBody("dpl_someone_else", FAILING_SHA, 2500) }, // recheck: moved
    ],
    "https://api.vercel.com/v6/deployments": [
      { status: 200, body: deploymentsBody([{ uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 }]) },
    ],
  });
  assert.equal(result.action, "skip");
  assert.match(result.reason, /moved during the check/);
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false,
    "a changed live id must never reach the promote POST",
  );
});

test("live production commit changes before promote -> skip, no POST issued", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", OTHER_SHA, 2000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      { status: 200, body: deploymentsBody([{ uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 }]) },
    ],
  });
  assert.deepEqual(result, {
    action: "skip",
    reason: `production already moved past the failing commit ${FAILING_SHA}`,
  });
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false,
    "a changed live sha must never reach the promote POST",
  );
});

test("production recheck HTTP failure -> failed, no POST issued", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 502, body: {} },
    ],
    "https://api.vercel.com/v6/deployments": [
      { status: 200, body: deploymentsBody([{ uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 }]) },
    ],
  });
  assert.equal(result.action, "failed");
  assert.equal(result.reason, "production recheck failed: HTTP 502");
  assert.equal(calls.some((c) => c.method === "POST"), false);
});

test("in-flight production deployment becomes terminal within budget -> waits and promotes", async () => {
  const delays = [];
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_prev", OLDER_SHA, 1000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      {
        status: 200,
        body: deploymentsBody([
          { uid: "dpl_building", state: "BUILDING", meta: { githubCommitSha: OTHER_SHA }, created: 3000 },
          { uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 },
        ]),
      },
      {
        status: 200,
        body: deploymentsBody([
          { uid: "dpl_building", state: "READY", meta: { githubCommitSha: OTHER_SHA }, created: 3000 },
          { uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 },
        ]),
      },
    ],
    "https://api.vercel.com/v10/projects/": [{ status: 200, body: {} }],
  }, async (ms) => delays.push(ms));
  assert.equal(result.action, "requested");
  assert.equal(result.deploymentId, "dpl_prev");
  assert.deepEqual(delays, [30_000]);
  assert.equal(
    calls.find((c) => c.url.startsWith("https://api.vercel.com/v6/deployments"))?.url,
    "https://api.vercel.com/v6/deployments?projectId=prj_test&target=production&limit=10",
  );
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("in-flight production deployment exhausts wait budget -> still promotes", async () => {
  const delays = [];
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_prev", OLDER_SHA, 1000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      {
        status: 200,
        body: deploymentsBody([
          { uid: "dpl_stuck", state: "BUILDING", meta: { githubCommitSha: OTHER_SHA }, created: 3000 },
          { uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 },
        ]),
      },
    ],
    "https://api.vercel.com/v10/projects/": [{ status: 200, body: {} }],
  }, async (ms) => delays.push(ms));
  assert.equal(result.action, "requested");
  assert.equal(result.deploymentId, "dpl_prev");
  assert.match(result.reason, /proceeded despite.*dpl_stuck BUILDING/i);
  assert.deepEqual(delays, Array(5).fill(30_000));
  assert.equal(
    calls.filter((c) => c.url.startsWith("https://api.vercel.com/v6/deployments")).length,
    6,
  );
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("production moves to a different commit after waiting -> skip, no POST issued", async () => {
  const delays = [];
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_other", OTHER_SHA, 3000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      {
        status: 200,
        body: deploymentsBody([
          { uid: "dpl_building", state: "BUILDING", meta: { githubCommitSha: OTHER_SHA }, created: 3000 },
          { uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 },
        ]),
      },
      {
        status: 200,
        body: deploymentsBody([
          { uid: "dpl_other", state: "READY", meta: { githubCommitSha: OTHER_SHA }, created: 3000 },
          { uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 },
        ]),
      },
    ],
  }, async (ms) => delays.push(ms));
  assert.deepEqual(result, {
    action: "skip",
    reason: `production already moved past the failing commit ${FAILING_SHA}`,
  });
  assert.deepEqual(delays, [30_000]);
  assert.equal(calls.some((c) => c.method === "POST"), false);
});

test("all production deployments terminal -> promotes as before", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_prev", OLDER_SHA, 1000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      {
        status: 200,
        body: deploymentsBody([
          { uid: "dpl_canceled", state: "CANCELED", meta: { githubCommitSha: OTHER_SHA }, created: 3000 },
          { uid: "dpl_error", state: "ERROR", meta: { githubCommitSha: OTHER_SHA }, created: 2500 },
          { uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 },
        ]),
      },
    ],
    "https://api.vercel.com/v10/projects/": [{ status: 200, body: {} }],
  });
  assert.equal(result.action, "requested");
  assert.equal(result.deploymentId, "dpl_prev");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("matching live production commit -> exactly one POST to promote the chosen deployment", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) }, // recheck: unchanged
      { status: 200, body: projectBody("dpl_prev", OLDER_SHA, 1000) }, // verification: promoted
    ],
    "https://api.vercel.com/v6/deployments": [
      {
        status: 200,
        body: deploymentsBody([
          { uid: "dpl_older", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 500 },
          // Newest qualifying candidate: should be picked over dpl_older.
          { uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000, inspectorUrl: "https://vercel.com/x/dpl_prev" },
        ]),
      },
    ],
    "https://api.vercel.com/v10/projects/": [{ status: 200, body: {} }],
  });
  assert.equal(result.action, "requested");
  assert.equal(result.deploymentId, "dpl_prev");
  assert.equal(result.httpStatus, 200);

  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://api.vercel.com/v10/projects/prj_test/promote/dpl_prev");
});

test("post-promote verification mismatch -> failed", async () => {
  const { result, calls } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_someone_else", OTHER_SHA, 3000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      { status: 200, body: deploymentsBody([{ uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 }]) },
    ],
    "https://api.vercel.com/v10/projects/": [{ status: 200, body: {} }],
  });
  assert.equal(result.action, "failed");
  assert.equal(result.reason, "promotion did not take effect, production is now dpl_someone_else");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("promote HTTP status controls the rollback action", async () => {
  const baseQueues = {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_prev", OLDER_SHA, 1000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      { status: 200, body: deploymentsBody([{ uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 }]) },
    ],
  };

  const failed = await rollback(FAILING_SHA, {
    ...baseQueues,
    "https://api.vercel.com/v10/projects/": [{ status: 403, body: {} }],
  });
  assert.equal(failed.result.action, "failed");
  assert.equal(failed.result.httpStatus, 403);
  assert.match(failed.result.reason, /403/);

  const requested = await rollback(FAILING_SHA, {
    ...baseQueues,
    "https://api.vercel.com/v10/projects/": [{ status: 202, body: {} }],
  });
  assert.equal(requested.result.action, "requested");
  assert.equal(requested.result.httpStatus, 202);
});

test("network error on promote -> failed, never throws", async () => {
  const { result } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      { status: 200, body: deploymentsBody([{ uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 }]) },
    ],
    "https://api.vercel.com/v10/projects/": [{ throw: new Error("network down") }],
  });
  assert.equal(result.action, "failed");
  assert.match(result.reason, /never reached Vercel/);
});

test("network error on the initial project lookup -> failed, never throws", async () => {
  const { result } = await rollback(FAILING_SHA, {
    "https://api.vercel.com/v9/projects/": [{ throw: new Error("network down") }],
  });
  assert.equal(result.action, "failed");
  assert.match(result.reason, /could not resolve/);
});

const HEAD_SHA = "3333333333333333333333333333333333333333";
const PARENT_SHA = "4444444444444444444444444444444444444444";
const TREE_SHA = "5555555555555555555555555555555555555555";
const REVERT_SHA = "6666666666666666666666666666666666666666";
const RUN_URL = "https://github.com/test/repo/actions/runs/123";

function durableQueues({ headSha = FAILING_SHA, comparisonCommits = [] } = {}) {
  return {
    "https://api.github.com/repos/test/repo/actions/variables/MERGE_FREEZE": [
      { status: 204, body: {} },
    ],
    "https://api.github.com/repos/test/repo/git/commits": [
      { status: 200, body: { parents: [{ sha: PARENT_SHA }] } },
      { status: 200, body: { tree: { sha: TREE_SHA } } },
      { status: 201, body: { sha: REVERT_SHA } },
    ],
    "https://api.github.com/repos/test/repo/git/ref/heads/production": [
      { status: 200, body: { object: { sha: headSha } } },
    ],
    "https://api.github.com/repos/test/repo/compare/": [
      {
        status: 200,
        body: {
          status: headSha === FAILING_SHA ? "identical" : "ahead",
          total_commits: comparisonCommits.length,
          commits: comparisonCommits,
        },
      },
    ],
    "https://api.github.com/repos/test/repo/git/refs/heads/production": [
      { status: 200, body: { object: { sha: REVERT_SHA } } },
    ],
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_other", OTHER_SHA, 3000) },
    ],
  };
}

async function durableRollback(queues) {
  const { emergencyRollback } = await import(scriptUrl);
  const { fetchImpl, calls } = makeFetch(queues);
  const result = await emergencyRollback(
    FAILING_SHA,
    "vercel-token",
    fetchImpl,
    async () => {},
    {
      durable: true,
      repository: "test/repo",
      githubToken: "github-token",
      runUrl: RUN_URL,
    },
  );
  return { result, calls };
}

test("durable rollback creates one revert commit and freezes merging", async () => {
  const { result, calls } = await durableRollback(durableQueues());

  assert.equal(result.action, "requested");
  assert.equal(result.freeze, true);
  assert.deepEqual(result.revert, {
    action: "created",
    sha: REVERT_SHA,
    revertedFrom: FAILING_SHA,
    revertedThrough: FAILING_SHA,
  });
  const create = calls.find(
    (call) => call.url.endsWith("/git/commits") && call.method === "POST",
  );
  assert.deepEqual(create.body, {
    message: "Revert deadbee: production smoke failed (auto-rollback)",
    tree: TREE_SHA,
    parents: [FAILING_SHA],
  });
  assert.deepEqual(
    calls.find((call) => call.url.endsWith("/git/refs/heads/production")).body,
    { sha: REVERT_SHA, force: false },
  );
});

test("production moving past the failed SHA reverts the whole range in one commit", async () => {
  const { result, calls } = await durableRollback(durableQueues({
    headSha: HEAD_SHA,
    comparisonCommits: [{ sha: HEAD_SHA, commit: { message: "later production merge" } }],
  }));

  assert.equal(result.action, "requested");
  assert.equal(result.revert.revertedThrough, HEAD_SHA);
  const create = calls.find(
    (call) => call.url.endsWith("/git/commits") && call.method === "POST",
  );
  assert.equal(create.body.tree, TREE_SHA, "the new tree restores the failing commit's parent");
  assert.deepEqual(create.body.parents, [HEAD_SHA], "the revert is based on the current production tip");
});

test("an existing production revert is the only durable skip", async () => {
  const message = "Revert deadbee: production smoke failed (auto-rollback)";
  const queues = durableQueues({
    headSha: HEAD_SHA,
    comparisonCommits: [{ sha: REVERT_SHA, commit: { message } }],
  });
  queues["https://api.github.com/repos/test/repo/git/commits"] = [
    { status: 200, body: { parents: [{ sha: PARENT_SHA }] } },
    { status: 200, body: { tree: { sha: TREE_SHA } } },
  ];
  const { result, calls } = await durableRollback(queues);

  assert.equal(result.action, "skip");
  assert.equal(result.revert.action, "already_reverted");
  assert.equal(
    calls.some((call) => call.method === "POST" && call.url.endsWith("/git/commits")),
    false,
  );
  assert.equal(calls.some((call) => call.url.startsWith("https://api.vercel.com")), false);
});

test("a red prod-health run disqualifies a READY Vercel rollback target", async () => {
  const { promotePreviousDeployment } = await import(scriptUrl);
  const { fetchImpl, calls } = makeFetch({
    "https://api.vercel.com/v9/projects/": [
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
      { status: 200, body: projectBody("dpl_live", FAILING_SHA, 2000) },
    ],
    "https://api.vercel.com/v6/deployments": [
      {
        status: 200,
        body: deploymentsBody([
          { uid: "dpl_prev", state: "READY", meta: { githubCommitSha: OLDER_SHA }, created: 1000 },
        ]),
      },
    ],
    "https://api.github.com/repos/test/repo/actions/workflows/prod-health.yml/runs": [
      {
        status: 200,
        body: {
          workflow_runs: [
            { status: "completed", conclusion: "failure", updated_at: "2026-09-20T12:00:00Z" },
          ],
        },
      },
    ],
  });

  const result = await promotePreviousDeployment(
    FAILING_SHA,
    "vercel-token",
    fetchImpl,
    async () => {},
    { repository: "test/repo", githubToken: "github-token" },
  );
  assert.equal(result.action, "skip");
  assert.match(result.reason, /green prod-health/);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("merge freeze is created when the repository variable does not exist", async () => {
  const { setMergeFreeze } = await import(scriptUrl);
  const { fetchImpl, calls } = makeFetch({
    "https://api.github.com/repos/test/repo/actions/variables/MERGE_FREEZE": [
      { status: 404, body: {} },
    ],
    "https://api.github.com/repos/test/repo/actions/variables": [
      { status: 201, body: {} },
    ],
  });

  assert.equal(await setMergeFreeze("test/repo", RUN_URL, "github-token", fetchImpl), true);
  const create = calls.find((call) => call.method === "POST");
  assert.deepEqual(create.body, { name: "MERGE_FREEZE", value: RUN_URL });
});

test("the smoke workflow uses the ruleset-capable token and keeps the manual guard", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/prod-health.yml"), "utf8");
  const smokeStart = workflow.indexOf("\n  smoke:");
  const smokeEnd = workflow.indexOf("\n  glm-qa:", smokeStart);
  const smoke = workflow.slice(smokeStart, smokeEnd);

  assert.match(smoke, /GITHUB_TOKEN: \$\{\{ secrets\.AUTOMERGE_TOKEN \|\| github\.token \}\}/);
  assert.match(smoke, /github\.event_name.*!= "push"/);
  assert.match(smoke, /workflow_dispatch never rolls back/);
  assert.match(smoke, /gh variable delete MERGE_FREEZE/);
});
