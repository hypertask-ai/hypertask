const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const script = pathToFileURL(path.join(__dirname, "../.github/scripts/emergency-rollback.mjs")).href;
const X = "a".repeat(40);
const HEAD = "b".repeat(40);
const PARENT = "c".repeat(40);
const REVERT = "d".repeat(40);
const OLD = "e".repeat(40);
const gh = "https://api.github.com/repos/hypertask-ai/hypertask";
const vercel = "https://api.vercel.com";

async function run(overrides = {}, opts = {}) {
  const calls = [];
  const replies = {
    [`PATCH ${gh}/actions/variables/MERGE_FREEZE`]: [204],
    [`GET ${gh}/git/ref/heads/production`]: [{ object: { sha: opts.head || X } }],
    [`GET ${gh}/git/commits/${X}`]: [{ parents: [{ sha: PARENT }], message: "bad merge" }],
    [`GET ${gh}/git/commits/${PARENT}`]: [{ tree: { sha: "old-tree" } }],
    [`POST ${gh}/git/commits`]: [{ sha: REVERT }],
    [`PATCH ${gh}/git/ref/heads/production`]: [200],
    [`GET ${vercel}/v9/projects/hypertasks-prod`]: [{ id: "project", targets: { production: { id: "live", createdAt: 200, meta: { githubCommitSha: X } } } }],
    [`GET ${vercel}/v6/deployments?projectId=project&target=production&limit=10`]: [{ deployments: [{ uid: "old", state: "READY", created: 100, meta: { githubCommitSha: OLD } }] }],
    [`GET ${gh}/actions/workflows/prod-health.yml/runs?head_sha=${OLD}&event=push&per_page=20`]: [{ workflow_runs: [] }],
    ...overrides,
  };
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    const key = `${method} ${url}`;
    calls.push({ key, body: init.body && JSON.parse(init.body) });
    if (!(key in replies)) throw Error(`unexpected ${key}`);
    const value = replies[key];
    const item = Array.isArray(value) ? value.shift() : value;
    const status = typeof item === "number" ? item : 200;
    return { ok: status >= 200 && status < 300, status, json: async () => item };
  };
  const { emergencyRollback } = await import(script);
  const result = await emergencyRollback(X, "vercel-token", fetchImpl, async () => {}, {
    repo: "hypertask-ai/hypertask", githubToken: "github-token",
    runUrl: "https://github.com/hypertask-ai/hypertask/actions/runs/123",
  });
  return { result, calls };
}

function called(calls, fragment) { return calls.find((c) => c.key.includes(fragment)); }

test("freezes merges, commits the pre-failure tree, and leaves Vercel alone without green smoke", async () => {
  const { result, calls } = await run();
  assert.equal(result.action, "requested");
  assert.equal(result.freeze, true);
  assert.deepEqual(result.revert, { status: "created", sha: REVERT, revertedThrough: X });
  assert.equal(called(calls, "POST https://api.github.com/repos/hypertask-ai/hypertask/git/commits").body.tree, "old-tree");
  assert.deepEqual(called(calls, "PATCH https://api.github.com/repos/hypertask-ai/hypertask/git/ref/heads/production").body, { sha: REVERT, force: false });
  assert.equal(calls.some((c) => c.key.includes("/promote/")), false);
});

test("production moved past X: revert the entire range in one commit", async () => {
  const { result, calls } = await run({ [`GET ${gh}/git/commits/${HEAD}`]: [{ parents: [{ sha: X }], message: "next merge" }] }, { head: HEAD });
  assert.equal(result.revert.revertedThrough, HEAD);
  assert.deepEqual(called(calls, `POST ${gh}/git/commits`).body.parents, [HEAD]);
});

test("a prior revert of X skips a second revert, but still freezes merges", async () => {
  const { result, calls } = await run({
    [`GET ${gh}/git/commits/${HEAD}`]: [{ parents: [{ sha: X }], message: `Revert ${X.slice(0, 7)}: production smoke failed (auto-rollback)` }],
  }, { head: HEAD });
  assert.equal(result.action, "skip");
  assert.equal(result.freeze, true);
  assert.equal(calls.some((c) => c.key === `POST ${gh}/git/commits`), false);
});

test("a non-fast-forward ref update fails closed with freeze in place", async () => {
  const { result } = await run({ [`PATCH ${gh}/git/ref/heads/production`]: [422] });
  assert.equal(result.action, "failed");
  assert.equal(result.freeze, true);
});

test("creates a missing MERGE_FREEZE variable", async () => {
  const { result, calls } = await run({
    [`PATCH ${gh}/actions/variables/MERGE_FREEZE`]: [404],
    [`POST ${gh}/actions/variables`]: [201],
  });
  assert.equal(result.freeze, true);
  assert.equal(called(calls, `POST ${gh}/actions/variables`).body.value, "https://github.com/hypertask-ai/hypertask/actions/runs/123");
});

test("freeze failure prevents a revert commit", async () => {
  const { result, calls } = await run({ [`PATCH ${gh}/actions/variables/MERGE_FREEZE`]: [403] });
  assert.equal(result.action, "failed");
  assert.equal(result.freeze, false);
  assert.equal(calls.some((c) => c.key === `POST ${gh}/git/commits`), false);
});

test("promotes only a deployment whose successful prod-health run actually passed smoke", async () => {
  const runs = { workflow_runs: [{ id: 42, head_sha: OLD, status: "completed", conclusion: "success" }] };
  const additions = {
    [`GET ${gh}/actions/workflows/prod-health.yml/runs?head_sha=${OLD}&event=push&per_page=20`]: [runs],
    [`GET ${gh}/actions/runs/42/jobs?per_page=100`]: [{ jobs: [{ name: "smoke", conclusion: "skipped" }] }],
  };
  const skipped = await run(additions);
  assert.equal(skipped.calls.some((c) => c.key.includes("/promote/")), false);
  additions[`GET ${gh}/actions/runs/42/jobs?per_page=100`] = [{ jobs: [{ name: "smoke", conclusion: "success" }] }];
  additions[`POST ${vercel}/v10/projects/project/promote/old`] = [200];
  additions[`GET ${vercel}/v9/projects/hypertasks-prod`] = [
    { id: "project", targets: { production: { id: "live", createdAt: 200, meta: { githubCommitSha: X } } } },
    { id: "project", targets: { production: { id: "live", createdAt: 200, meta: { githubCommitSha: X } } } },
    { id: "project", targets: { production: { id: "old", createdAt: 100, meta: { githubCommitSha: OLD } } } },
  ];
  const green = await run(additions);
  assert.equal(green.result.deploymentId, "old");
  assert.equal(green.result.action, "requested");
  assert.equal(green.result.freeze, true);
});

test("manual dispatch never freezes or reverts", async () => {
  const before = process.env.GITHUB_EVENT_NAME;
  process.env.GITHUB_EVENT_NAME = "workflow_dispatch";
  try {
    const { result, calls } = await run();
    assert.equal(result.action, "skip");
    assert.equal(result.freeze, false);
    assert.deepEqual(calls, []);
  } finally {
    if (before === undefined) delete process.env.GITHUB_EVENT_NAME;
    else process.env.GITHUB_EVENT_NAME = before;
  }
});
