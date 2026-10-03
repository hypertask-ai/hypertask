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
const identity = { name: "Hypertask Rollback Bot", email: "hypertask-rollback@users.noreply.github.com" };
const rollback = (sha, parent = PARENT) => ({
  parents: [{ sha: parent }], tree: { sha: "old-tree" }, author: identity, committer: identity,
  message: `Revert ${sha.slice(0, 7)}: production smoke failed (auto-rollback)\n\nAuto-Rollback-Of: ${sha}`,
});

async function run(overrides = {}, opts = {}) {
  const calls = [];
  const replies = {
    [`GET ${gh}/actions/variables/MERGE_FREEZE`]: [404],
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
    const item = typeof value === "function" ? value(calls) : Array.isArray(value) ? (value.length > 1 ? value.shift() : value[0]) : value;
    const status = typeof item === "number" ? item : 200;
    return { ok: status >= 200 && status < 300, status, json: async () => item };
  };
  const { emergencyRollback } = await import(script);
  const result = await emergencyRollback(X, opts.vercelToken ?? "vercel-token", fetchImpl, async () => {}, {
    repo: opts.repo ?? "hypertask-ai/hypertask", githubToken: opts.githubToken ?? "github-token",
    runUrl: opts.runUrl ?? "https://github.com/hypertask-ai/hypertask/actions/runs/123",
  });
  const retried = opts.repeatSha ? await emergencyRollback(opts.repeatSha, "vercel-token", fetchImpl, async () => {}, {
    repo: "hypertask-ai/hypertask", githubToken: "github-token",
    runUrl: "https://github.com/hypertask-ai/hypertask/actions/runs/124",
  }) : undefined;
  return { result, calls, retried };
}

function called(calls, fragment) { return calls.find((c) => c.key.includes(fragment)); }

test("freezes merges, commits the pre-failure tree, and leaves Vercel alone without green smoke", async () => {
  const { result, calls } = await run();
  assert.equal(result.action, "requested");
  assert.equal(result.freeze, true);
  assert.deepEqual(result.revert, { status: "created", sha: REVERT, revertedThrough: X, dropped: [{ sha: X, title: "bad merge" }] });
  assert.equal(called(calls, "POST https://api.github.com/repos/hypertask-ai/hypertask/git/commits").body.tree, "old-tree");
  assert.equal(called(calls, `POST ${gh}/git/commits`).body.author.email, identity.email);
  assert.equal(called(calls, `POST ${gh}/git/commits`).body.committer.email, identity.email);
  assert.match(called(calls, `POST ${gh}/git/commits`).body.message, new RegExp(`Auto-Rollback-Of: ${X}$`));
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
    [`GET ${gh}/git/commits/${HEAD}`]: [rollback(X, X)],
  }, { head: HEAD });
  assert.equal(result.action, "skip");
  assert.equal(result.freeze, true);
  assert.equal(calls.some((c) => c.key === `POST ${gh}/git/commits`), false);
});

test("a genuine failing auto-rollback skips another revert but promotes the last green deployment", async () => {
  const { result, calls } = await run({
    ...greenSmoke(),
    [`GET ${gh}/git/commits/${X}`]: [rollback(OLD)],
    [`GET ${gh}/git/commits/${OLD}`]: [{ parents: [{ sha: PARENT }] }],
  });
  assert.equal(result.action, "skip");
  assert.equal(result.freeze, true);
  assert.equal(result.revert.status, "auto-rollback");
  assert.equal(calls.some((c) => c.key === `POST ${gh}/git/commits`), false);
  assert.equal(result.promotion.action, "requested");
  assert.ok(called(calls, `POST ${vercel}/v10/projects/project/promote/old`));
});

test("forged rollback messages, trees and identities never suppress a revert", async () => {
  for (const forged of [
    { ...rollback(OLD), message: `Revert ${OLD.slice(0, 7)}: production smoke failed (auto-rollback)` },
    { ...rollback(OLD), tree: { sha: "wrong-tree" } },
    { ...rollback(OLD), author: { email: "other@example.com" } },
    { ...rollback(OLD), committer: { email: "other@example.com" } },
  ]) {
    const { result, calls } = await run({
      [`GET ${gh}/git/commits/${X}`]: [forged],
      [`GET ${gh}/git/commits/${OLD}`]: [{ parents: [{ sha: PARENT }] }],
    });
    assert.equal(result.revert.status, "created");
    assert.ok(called(calls, `POST ${gh}/git/commits`));
  }
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
  const { result } = await run({
    [`PATCH ${gh}/git/ref/heads/production`]: [422],
    [`GET ${gh}/git/ref/heads/production`]: [{ object: { sha: X } }, { object: { sha: X } }],
  });
  assert.equal(result.action, "failed");
  assert.equal(result.freeze, true);
});

test("a concurrent verified rollback is reported as already reverted, not a failure", async () => {
  const { result, calls } = await run({
    [`PATCH ${gh}/git/ref/heads/production`]: [422],
    [`GET ${gh}/git/ref/heads/production`]: [{ object: { sha: X } }, { object: { sha: HEAD } }],
    [`GET ${gh}/git/commits/${HEAD}`]: [rollback(X, X)],
    [`GET ${gh}/git/commits/${X}`]: [
      { parents: [{ sha: PARENT }], message: "bad merge" },
      { parents: [{ sha: PARENT }], message: "bad merge" },
    ],
  });
  assert.equal(result.action, "skip");
  assert.equal(result.revert.status, "already-reverted");
  assert.equal(result.revert.sha, HEAD);
  assert.ok(called(calls, `GET ${vercel}/v9/projects/hypertasks-prod`));
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
    [`GET ${gh}/git/ref/heads/production`]: [{ object: { sha: X } }, { object: { sha: X } }],
    ...greenSmoke(),
  });
  assert.equal(result.freeze, true);
  assert.equal(result.revert.status, "failed");
  assert.match(result.errors.revert, /422/);
  assert.equal(result.promotion.action, "requested");
  assert.ok(called(calls, `POST ${vercel}/v10/projects/project/promote/old`));
});

test("missing rollback credentials or run context fail closed before any operation", async () => {
  for (const [options, expected] of [
    [{ githubToken: "", runUrl: "" }, /ROLLBACK_GITHUB_TOKEN.*run URL/],
    [{ repo: "" }, /GITHUB_REPOSITORY/],
    [{ runUrl: "" }, /run URL/],
    [{ vercelToken: "" }, /VERCEL_TOKEN/],
  ]) {
    const { result, calls } = await run(greenSmoke(), options);
    assert.equal(result.action, "failed");
    assert.equal(result.freeze, false);
    assert.equal(result.revert.status, "skipped");
    assert.match(result.reason, expected);
    assert.equal(calls.length, 0);
  }
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
    [`GET ${vercel}/v9/projects/hypertasks-prod`]: (calls) => ({
      id: "project", targets: { production: calls.some((call) => call.key.includes("POST") && call.key.includes("/promote/"))
        ? { id: "old", createdAt: 100, meta: { githubCommitSha: OLD } }
        : { id: "live", createdAt: 200, meta: { githubCommitSha: X } } },
    }),
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

test("only the isolated confirmed-failure job invokes rollback", async () => {
  const workflow = await readFile(path.join(__dirname, "../.github/workflows/prod-health.yml"), "utf8");
  const boundary = workflow.indexOf("\n  rollback:");
  assert.ok(boundary > 0);
  assert.doesNotMatch(workflow.slice(0, boundary), /emergency-rollback|ROLLBACK_GITHUB_TOKEN|\/promote\//);
  assert.match(workflow.slice(boundary), /emergency-rollback|ROLLBACK_GITHUB_TOKEN/);
});

test("monitoring test jobs do not retain a write-capable checkout token", async () => {
  const workflow = await readFile(path.join(__dirname, "../.github/workflows/prod-health.yml"), "utf8");
  const smoke = workflow.slice(workflow.indexOf("\n  smoke:"), workflow.indexOf("\n  glm-qa:"));
  const coreActions = workflow.slice(
    workflow.indexOf("\n  core-actions:"),
    workflow.indexOf("\n  provision-core-actions:"),
  );

  for (const job of [smoke, coreActions]) {
    assert.match(job, /permissions:\n\s+contents: read\n\s+statuses: write/);
    assert.doesNotMatch(job, /^\s+(?:actions|contents): write$/m);
    assert.match(job, /persist-credentials: false/);
  }
  assert.doesNotMatch(smoke, /ROLLBACK_GITHUB_TOKEN|VERCEL_TOKEN/);
  assert.doesNotMatch(smoke, /froze merging/);
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


test("an existing freeze stops all GitHub and Vercel mutations", async () => {
  const { result, calls } = await run({ [`GET ${gh}/actions/variables/MERGE_FREEZE`]: [{ value: "incident run" }] });
  assert.equal(result.action, "skip");
  assert.equal(result.freeze, true);
  assert.equal(calls.length, 1);
  assert.equal(result.revert.status, "skipped");
});

test("a failed rollback is not retried while its freeze remains", async () => {
  const { result, retried, calls } = await run({
    [`GET ${gh}/actions/variables/MERGE_FREEZE`]: [404, { value: "incident run" }],
    [`POST ${gh}/git/commits`]: [403],
  }, { repeatSha: X });
  assert.equal(result.action, "failed");
  assert.equal(result.freeze, true);
  assert.equal(retried.action, "skip");
  assert.equal(calls.filter((call) => call.key === `POST ${gh}/git/commits`).length, 1);
  assert.equal(calls.filter((call) => call.key === `PATCH ${gh}/actions/variables/MERGE_FREEZE`).length, 1);
});

test("a red rollback commit cannot start another rollback or promotion", async () => {
  const { result, retried, calls } = await run({
    [`GET ${gh}/actions/variables/MERGE_FREEZE`]: [404, { value: "incident run" }],
  }, { repeatSha: REVERT });
  assert.equal(result.revert.status, "created");
  assert.equal(retried.action, "skip");
  assert.equal(calls.filter((call) => call.key === `POST ${gh}/git/commits`).length, 1);
  assert.equal(calls.some((call) => call.key.includes("/promote/")), false);
});

test("an unreadable freeze fails closed without attempting a rollback", async () => {
  for (const reply of [403, 503, {}, { value: 42 }]) {
    const { result, calls } = await run({ [`GET ${gh}/actions/variables/MERGE_FREEZE`]: [reply] });
    assert.equal(result.action, "failed");
    assert.match(result.reason, /Cannot read MERGE_FREEZE/);
    assert.equal(calls.length, 1);
  }
});


test("a superseded failure never freezes merging or reverts the newer live release", async () => {
  const { result, calls } = await run({
    [`GET ${vercel}/v9/projects/hypertasks-prod`]: [{ id: "project", targets: { production: { id: "new", meta: { githubCommitSha: HEAD } } } }],
  }, { head: HEAD });
  assert.equal(result.action, "skip");
  assert.equal(result.freeze, false);
  assert.equal(result.revert.status, "superseded");
  assert.equal(calls.some((call) => /^(POST|PATCH) /.test(call.key)), false);
});

test("a newer release becoming live during the freeze cannot be reverted or promoted away", async () => {
  const { result, calls } = await run({
    [`GET ${vercel}/v9/projects/hypertasks-prod`]: [
      { id: "project", targets: { production: { id: "live", meta: { githubCommitSha: X } } } },
      { id: "project", targets: { production: { id: "new", meta: { githubCommitSha: HEAD } } } },
    ],
  });
  assert.equal(result.freeze, true);
  assert.equal(result.revert.status, "superseded");
  assert.equal(calls.some((call) => call.key === `POST ${gh}/git/commits` || call.key.includes("/promote/")), false);
});

test("unavailable or missing live production identity cannot trigger a rollback", async () => {
  for (const reply of [403, 503, {}, { targets: { production: { id: "live" } } }]) {
    const { result, calls } = await run({ [`GET ${vercel}/v9/projects/hypertasks-prod`]: [reply] });
    assert.equal(result.action, "failed");
    assert.equal(result.freeze, false);
    assert.equal(calls.some((call) => /^(POST|PATCH) /.test(call.key)), false);
  }
});
