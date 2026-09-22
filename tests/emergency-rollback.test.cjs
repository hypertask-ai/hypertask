const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { readFile } = require("node:fs/promises");

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
  const result = await emergencyRollback(X, opts.vercelToken ?? "vercel-token", fetchImpl, async () => {}, {
    repo: opts.repo ?? "hypertask-ai/hypertask", githubToken: opts.githubToken ?? "github-token",
    runUrl: opts.runUrl ?? "https://github.com/hypertask-ai/hypertask/actions/runs/123",
  });
  return { result, calls };
}

function called(calls, fragment) { return calls.find((c) => c.key.includes(fragment)); }

test("freezes merges, commits the pre-failure tree, and leaves Vercel alone without green smoke", async () => {
  const { result, calls } = await run();
  assert.equal(result.action, "requested");
  assert.equal(result.freeze, true);
  assert.deepEqual(result.revert, { status: "created", sha: REVERT, revertedThrough: X, dropped: [{ sha: X, title: "bad merge" }] });
  assert.equal(called(calls, "POST https://api.github.com/repos/hypertask-ai/hypertask/git/commits").body.tree, "old-tree");
  assert.deepEqual(called(calls, "PATCH https://api.github.com/repos/hypertask-ai/hypertask/git/ref/heads/production").body, { sha: REVERT, force: false });
  assert.equal(calls.some((c) => c.key.includes("/promote/")), false);
});

test("production moved past X: revert the entire range in one commit", async () => {
  const { result, calls } = await run({ [`GET ${gh}/git/commits/${HEAD}`]: [{ parents: [{ sha: X }], message: "next merge" }] }, { head: HEAD });
  assert.equal(result.revert.revertedThrough, HEAD);
  assert.deepEqual(result.revert.dropped, [{ sha: X, title: "bad merge" }, { sha: HEAD, title: "next merge" }]);
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

test("a failing auto-rollback commit only freezes; it never reverts or promotes", async () => {
  const { result, calls } = await run({
    [`GET ${gh}/git/commits/${X}`]: [{ parents: [{ sha: PARENT }], message: `Revert ${OLD.slice(0, 7)}: production smoke failed (auto-rollback)` }],
  });
  assert.equal(result.action, "skip");
  assert.equal(result.freeze, true);
  assert.equal(result.revert.status, "auto-rollback");
  assert.equal(calls.some((c) => c.key === `POST ${gh}/git/commits`), false);
  assert.equal(calls.some((c) => c.key.includes("/promote/")), false);
  assert.equal(calls.some((c) => new URL(c.key.split(" ")[1]).hostname === "api.vercel.com"), false);
});

test("stops after 100 commits when failing SHA is not in production history", async () => {
  const chain = {};
  for (let i = 100; i > 0; i--) {
    const sha = i.toString(16).padStart(40, "0");
    chain[`GET ${gh}/git/commits/${sha}`] = [{ message: "unrelated", parents: [{ sha: (i - 1).toString(16).padStart(40, "0") }] }];
  }
  const { result, calls } = await run(chain, { head: (100).toString(16).padStart(40, "0") });
  assert.equal(result.freeze, true);
  assert.equal(result.action, "failed");
  assert.equal(result.revert.status, "failed");
  assert.match(result.errors.revert, /not found.*100/);
  assert.match(result.reason, /revert:.*not found/);
  assert.equal(calls.filter((c) => c.key.startsWith(`GET ${gh}/git/commits/`)).length, 101);
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

test("freeze failure still reverts and tries to promote", async () => {
  const { result, calls } = await run({ [`PATCH ${gh}/actions/variables/MERGE_FREEZE`]: [403] });
  assert.equal(result.action, "failed");
  assert.equal(result.freeze, false);
  assert.match(result.errors.freeze, /403/);
  assert.equal(result.revert.status, "created");
  assert.ok(called(calls, `POST ${gh}/git/commits`));
  assert.ok(called(calls, `GET ${vercel}/v9/projects/hypertasks-prod`));
});

test("revert failure still freezes and promotes a verified deployment", async () => {
  const { result, calls } = await run({
    [`PATCH ${gh}/git/ref/heads/production`]: [422],
    ...greenSmoke(),
  });
  assert.equal(result.freeze, true);
  assert.equal(result.revert.status, "failed");
  assert.match(result.errors.revert, /422/);
  assert.equal(result.promotion.action, "requested");
  assert.ok(called(calls, `POST ${vercel}/v10/projects/project/promote/old`));
});

test("missing GitHub token and run URL do not prevent a verified Vercel promotion", async () => {
  const { result, calls } = await run(greenSmoke(), { githubToken: "", runUrl: "" });
  assert.equal(result.action, "failed");
  assert.match(result.errors.freeze, /ROLLBACK_GITHUB_TOKEN.*run URL/);
  assert.match(result.errors.revert, /ROLLBACK_GITHUB_TOKEN/);
  assert.equal(result.freeze, false);
  assert.equal(result.revert.status, "failed");
  assert.equal(result.promotion.action, "requested");
  assert.ok(called(calls, `POST ${vercel}/v10/projects/project/promote/old`));
  assert.equal(called(calls, `GET ${gh}/actions/workflows/prod-health.yml/runs`).body, undefined);
  assert.equal(calls.some((c) => c.key === `PATCH ${gh}/actions/variables/MERGE_FREEZE`), false);
});

test("missing repository skips GitHub writes but still checks the public smoke run for promotion", async () => {
  const { result, calls } = await run(greenSmoke(), { repo: "" });
  assert.match(result.errors.freeze, /GITHUB_REPOSITORY/);
  assert.match(result.errors.revert, /GITHUB_REPOSITORY/);
  assert.equal(result.promotion.action, "requested");
  assert.equal(calls.some((c) => c.key === `POST ${gh}/git/commits`), false);
});

test("missing run URL still reverts; missing Vercel token still freezes and reverts", async () => {
  const missingUrl = await run({}, { runUrl: "" });
  assert.match(missingUrl.result.errors.freeze, /run URL/);
  assert.equal(missingUrl.result.revert.status, "created");
  assert.ok(called(missingUrl.calls, `POST ${gh}/git/commits`));

  const missingVercel = await run({}, { vercelToken: "" });
  assert.equal(missingVercel.result.freeze, true);
  assert.equal(missingVercel.result.revert.status, "created");
  assert.match(missingVercel.result.errors.promotion, /VERCEL_TOKEN/);
  assert.equal(missingVercel.result.promotion.action, "failed");
});

test("promotion failure is reported independently of a successful freeze and revert", async () => {
  const { result } = await run({
    ...greenSmoke(),
    [`POST ${vercel}/v10/projects/project/promote/old`]: [503],
  });
  assert.equal(result.action, "failed");
  assert.equal(result.freeze, true);
  assert.equal(result.revert.status, "created");
  assert.match(result.errors.promotion, /503/);
});

function greenSmoke() {
  return {
    [`GET ${gh}/actions/workflows/prod-health.yml/runs?head_sha=${OLD}&event=push&per_page=20`]: [
      { workflow_runs: [{ id: 42, head_sha: OLD, status: "completed", conclusion: "success" }] },
    ],
    [`GET ${gh}/actions/runs/42/jobs?per_page=100`]: [
      { jobs: [{ name: "smoke", conclusion: "success", steps: [{ name: "Run the smoke checks", conclusion: "success" }] }] },
    ],
    [`POST ${vercel}/v10/projects/project/promote/old`]: [200],
    [`GET ${vercel}/v9/projects/hypertasks-prod`]: [
      { id: "project", targets: { production: { id: "live", createdAt: 200, meta: { githubCommitSha: X } } } },
      { id: "project", targets: { production: { id: "live", createdAt: 200, meta: { githubCommitSha: X } } } },
      { id: "project", targets: { production: { id: "old", createdAt: 100, meta: { githubCommitSha: OLD } } } },
    ],
  };
}

test("promotes only a deployment whose smoke test step actually succeeded", async () => {
  for (const conclusion of ["skipped", "failure", undefined]) {
    const additions = greenSmoke();
    additions[`GET ${gh}/actions/runs/42/jobs?per_page=100`] = [
      { jobs: [{ name: "smoke", conclusion: "success", steps: conclusion && [{ name: "Run the smoke checks", conclusion }] }] },
    ];
    const skipped = await run(additions);
    assert.equal(skipped.calls.some((c) => c.key.includes("/promote/")), false);
  }
  const green = await run(greenSmoke());
  assert.equal(green.result.deploymentId, "old");
  assert.equal(green.result.action, "requested");
  assert.equal(green.result.freeze, true);
});

test("both rollback alerts include all dropped commits and each failed operation", async () => {
  const workflow = await readFile(path.join(__dirname, "../.github/workflows/prod-health.yml"), "utf8");
  assert.match(workflow, /Dropped commits:[\s\S]*?\.revert\.dropped/);
  assert.match(workflow, /Errors: [\s\S]*?\.errors/);
  assert.match(workflow, /CORE_SMOKE_ROLLBACK=\$SUMMARY/);
  assert.match(workflow, /SUMMARY=[\s\S]*?\.revert\.dropped/);
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
