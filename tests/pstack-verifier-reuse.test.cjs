const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { buildMarker, sha256 } = require("../scripts/lib/pstack-compare.cjs");

const load = () => import("../scripts/pstack-verifier.mjs");
const recheck = () => import("../.github/scripts/pstack-verifier-recheck.mjs");

const BASE = "b".repeat(40);
const TREE = "c".repeat(40);
const RUN = "44324338876";
const REPO = "acme/app";
const BOT = "hypertask-runners[bot]";

function diffFor(extra = "") {
  return `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new${extra}\n`;
}

function markerBodies({ base = BASE, tree = TREE } = {}) {
  return buildMarker({ run: Number(RUN), attempt: 1, head: "d".repeat(40), tree, base });
}

test("a diff that only changes whitespace inside a value gets a different hash, so no reuse", () => {
  const first = sha256(diffFor());
  const second = sha256(diffFor(" "));
  assert.notEqual(first, second);
});

test("a patch id is a full sha and an unreadable patch gives nothing", async () => {
  const { patchIdOf } = await load();
  const ok = patchIdOf(diffFor(), () => ({ status: 0, stdout: `${"a".repeat(40)} 0000000\n` }));
  assert.equal(ok, "a".repeat(40));
  assert.equal(patchIdOf(diffFor(), () => ({ status: 1, stdout: "" })), "");
  assert.equal(patchIdOf(diffFor(), () => ({ status: 0, stdout: "not-a-sha" })), "");
});

const artifact = (overrides = {}) => ({ run: RUN, attempt: "1", head: "d".repeat(40), tree: TREE, baseSha: BASE, patchId: "e".repeat(40), diffSha256: sha256(diffFor()), verdict: "PASS", authorFamily: "deepseek", verifierModel: "google/gemini-3.8-flash", ...overrides });

test("a reused verdict posts a success only for the same trees, base, patch and diff", async () => {
  const { reusePayload } = await load();
  const comment = { user: { login: BOT }, body: markerBodies() };
  const status = { state: "success", context: "pstack-verifier", target_url: `https://github.com/${REPO}/actions/runs/${RUN}/attempts/1` };
  const item = { number: 5, base: { sha: BASE } };
  const current = { item, sha: "d".repeat(40), tree: TREE, diff: diffFor(), patchId: "e".repeat(40) };
  const hit = reusePayload({ ...current, comments: [comment], artifact: artifact(), status, repo: REPO });
  assert.equal(hit.reuse, true);
  assert.equal(hit.verdict, "PASS");
  const otherTree = reusePayload({ ...current, tree: "f".repeat(40), comments: [comment], artifact: artifact(), status, repo: REPO });
  assert.equal(otherTree.reuse, false);
  const forged = reusePayload({ ...current, comments: [{ user: { login: "someone" }, body: markerBodies() }], artifact: artifact(), status, repo: REPO });
  assert.equal(forged.reuse, false);
  const borrowed = reusePayload({ ...current, comments: [comment], artifact: artifact(), status: { ...status, target_url: `https://github.com/${REPO}/actions/runs/1/attempts/1` }, repo: REPO });
  assert.equal(borrowed.reuse, false);
  const newBase = reusePayload({ ...current, item: { number: 5, base: { sha: "a".repeat(40) } }, comments: [comment], artifact: artifact(), status, repo: REPO });
  assert.equal(newBase.reuse, false);
});

test("resolve stops and publishes when the same head tree was already verified", async () => {
  const { resolveCommand } = await load();
  const head = "d".repeat(40);
  const work = mkdtempSync(join(tmpdir(), "pv-reuse-"));
  const output = join(work, "out");
  writeFileSync(output, "");
  const artifactDir = join(tmpdir(), `pstack-reuse-${RUN}`);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "verdict.json"), JSON.stringify(artifact({ diffSha256: sha256(diffFor()), tree: TREE })));
  const savedEnv = ["GH_TOKEN", "GITHUB_REPOSITORY", "HEAD_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "WORK", "GITHUB_OUTPUT", "RUNNER_TEMP"].map((key) => [key, process.env[key]]);
  Object.assign(process.env, { GH_TOKEN: "t", GITHUB_REPOSITORY: REPO, HEAD_SHA: head, GITHUB_RUN_ID: "11", GITHUB_RUN_ATTEMPT: "1", WORK: work, GITHUB_OUTPUT: output, RUNNER_TEMP: tmpdir() });
  const posts = [];
  const pull = { number: 5, state: "open", draft: false, user: { login: "octocat" }, title: "t", body: "Author-Model: deepseek", base: { ref: "production", sha: BASE }, head: { sha: head, repo: { full_name: REPO } } };
  try {
    await resolveCommand({
      event: { workflow_run: { conclusion: "success", head_sha: head, pull_requests: [{ number: 5 }] } },
      spawn: () => ({ status: 0, stdout: `${"e".repeat(40)} 0000000\n` }),
      postStatus: async (row) => { posts.push(row); },
      gh: (args) => {
        const url = args.join(" ");
        if (url.includes("/issues/5/comments")) return JSON.stringify([{ user: { login: BOT }, body: markerBodies() }]);
        if (url.startsWith("run download")) return "";
        if (url.includes("/statuses")) return JSON.stringify([{ context: "pstack-verifier", creator: { login: "hypertask-runners[bot]" }, state: "success", target_url: `https://github.com/${REPO}/actions/runs/${RUN}/attempts/1` }]);
        if (url.includes(`/commits/${head}`)) return JSON.stringify({ commit: { tree: { sha: TREE } } });
        if (url.includes("/pulls/5/commits")) return "[]";
        if (url.includes("vnd.github.diff")) return diffFor();
        if (url.includes("/pulls/5")) return JSON.stringify(pull);
        throw new Error(url);
      },
    });
    const written = String(require("node:fs").readFileSync(output, "utf8"));
    assert.match(written, /stop=true/);
    assert.match(written, /mark=success/);
    assert.deepEqual(posts, []);
  } finally {
    for (const [key, value] of savedEnv) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
});

test("a reused verdict from another author family is not reused", async () => {
  const { resolveCommand } = await load();
  const head = "d".repeat(40);
  const work = mkdtempSync(join(tmpdir(), "pv-author-change-"));
  const output = join(work, "out");
  writeFileSync(output, "");
  const artifactDir = join(tmpdir(), `pstack-reuse-${RUN}`);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "verdict.json"), JSON.stringify(artifact({ diffSha256: sha256(diffFor()), tree: TREE })));
  const savedEnv = ["GH_TOKEN", "GITHUB_REPOSITORY", "HEAD_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "WORK", "GITHUB_OUTPUT", "RUNNER_TEMP"].map((key) => [key, process.env[key]]);
  Object.assign(process.env, { GH_TOKEN: "t", GITHUB_REPOSITORY: REPO, HEAD_SHA: head, GITHUB_RUN_ID: "11", GITHUB_RUN_ATTEMPT: "1", WORK: work, GITHUB_OUTPUT: output, RUNNER_TEMP: tmpdir() });
  const pull = { number: 5, state: "open", draft: false, user: { login: "octocat" }, title: "t", body: "Author-Model: codex", base: { ref: "production", sha: BASE }, head: { sha: head, repo: { full_name: REPO } } };
  try {
    await resolveCommand({
      event: { workflow_run: { conclusion: "success", head_sha: head, pull_requests: [{ number: 5 }] } },
      spawn: () => ({ status: 0, stdout: `${"e".repeat(40)} 0000000\n` }),
      postStatus: async () => {},
      gh: (args) => {
        const url = args.join(" ");
        if (url.includes("/issues/5/comments")) return JSON.stringify([{ user: { login: BOT }, body: markerBodies() }]);
        if (url.startsWith("run download")) return "";
        if (url.includes("/statuses")) return JSON.stringify([{ context: "pstack-verifier", creator: { login: "hypertask-runners[bot]" }, state: "success", target_url: `https://github.com/${REPO}/actions/runs/${RUN}/attempts/1` }]);
        if (url.includes(`/commits/${head}`)) return JSON.stringify({ commit: { tree: { sha: TREE } } });
        if (url.includes("/pulls/5/commits")) return "[]";
        if (url.includes("vnd.github.diff")) return diffFor();
        if (url.includes("/pulls/5/files")) return "";
        if (url.includes("/pulls/5")) return JSON.stringify(pull);
        throw new Error(url);
      },
    });
    assert.doesNotMatch(String(require("node:fs").readFileSync(output, "utf8")), /mark=success/);
  } finally {
    for (const [key, value] of savedEnv) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
});

test("resolve keeps going when the earlier artifact is gone", async () => {
  const { resolveCommand } = await load();
  const head = "d".repeat(40);
  const work = mkdtempSync(join(tmpdir(), "pv-noreuse-"));
  const output = join(work, "out");
  writeFileSync(output, "");
  const savedEnv = ["GH_TOKEN", "GITHUB_REPOSITORY", "HEAD_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "WORK", "GITHUB_OUTPUT", "RUNNER_TEMP"].map((key) => [key, process.env[key]]);
  Object.assign(process.env, { GH_TOKEN: "t", GITHUB_REPOSITORY: REPO, HEAD_SHA: head, GITHUB_RUN_ID: "11", GITHUB_RUN_ATTEMPT: "1", WORK: work, GITHUB_OUTPUT: output, RUNNER_TEMP: work });
  const pull = { number: 5, state: "open", draft: false, user: { login: "octocat" }, title: "t", body: "Author-Model: deepseek", base: { ref: "production", sha: BASE }, head: { sha: head, repo: { full_name: REPO } } };
  try {
    await resolveCommand({
      event: { workflow_run: { conclusion: "success", head_sha: head, pull_requests: [{ number: 5 }] } },
      spawn: () => ({ status: 0, stdout: `${"e".repeat(40)} 0000000\n` }),
      gh: (args) => {
        const url = args.join(" ");
        if (url.includes("/issues/5/comments")) return JSON.stringify([{ user: { login: BOT }, body: markerBodies() }]);
        if (url.startsWith("run download")) throw new Error("artifact expired");
        if (url.includes(`/commits/${head}`)) return JSON.stringify({ commit: { tree: { sha: TREE } } });
        if (url.includes("/pulls/5/commits")) return "[]";
        if (url.includes("vnd.github.diff")) return diffFor();
        if (url.includes("/pulls/5/files")) return "";
        if (url.includes("/pulls/5/commits")) return "[]";
        if (url.includes("/pulls/5")) return JSON.stringify(pull);
        throw new Error(url);
      },
    });
    assert.doesNotMatch(String(require("node:fs").readFileSync(output, "utf8")), /mark=success/);
  } finally {
    for (const [key, value] of savedEnv) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
});

test("a base that moved during the run leaves the verdict pending for the recheck", async () => {
  const { postCommand } = await load();
  const head = "d".repeat(40);
  const work = mkdtempSync(join(tmpdir(), "pv-moved-"));
  mkdirSync(join(work, "verdict"));
  writeFileSync(join(work, "verdict", "verdict.json"), JSON.stringify({ verdict: "PASS", notes: "", sha: head, run: "10", attempt: "1", baseSha: BASE, tree: TREE, authorFamily: "deepseek", verifierModel: "" }));
  const savedEnv = ["GH_TOKEN", "GITHUB_REPOSITORY", "HEAD_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "PR", "WORK"].map((key) => [key, process.env[key]]);
  Object.assign(process.env, { GH_TOKEN: "t", GITHUB_REPOSITORY: REPO, HEAD_SHA: head, GITHUB_RUN_ID: "10", GITHUB_RUN_ATTEMPT: "1", PR: "5", WORK: work });
  const posts = [];
  const comments = [];
  const pull = { state: "open", draft: false, base: { ref: "production", sha: "a".repeat(40) }, head: { sha: head, repo: { full_name: REPO } } };
  try {
    await postCommand({
      gh: (args) => {
        const url = String(args[1] ?? "");
        if (url === `repos/${REPO}/pulls/5`) return JSON.stringify(pull);
        if (url === `repos/${REPO}/commits/${head}/statuses`) return JSON.stringify([{ context: "pstack-verifier", creator: { login: "hypertask-runners[bot]" }, state: "pending", target_url: `https://github.com/${REPO}/actions/runs/10/attempts/1` }]);
        throw new Error(url);
      },
      token: "app-token",
      fetch: async (_url, options) => { posts.push(JSON.parse(options.body)); return { ok: true }; },
    });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].state, "pending");
    assert.equal(posts[0].description, "waiting for required checks");
    assert.equal(comments.length, 0);
  } finally {
    for (const [key, value] of savedEnv) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
});

test("a verdict comment carries the marker reuse and base drift read", async () => {
  const { buildMarker } = require("../scripts/lib/pstack-compare.cjs");
  const marker = buildMarker({ run: 10, attempt: 1, head: "d".repeat(40), tree: TREE, base: BASE });
  const posted = [];
  const { postCommand } = await load();
  const head = "d".repeat(40);
  const work = mkdtempSync(join(tmpdir(), "pv-marker-"));
  mkdirSync(join(work, "verdict"));
  writeFileSync(join(work, "verdict", "verdict.json"), JSON.stringify({ verdict: "PASS", notes: "", sha: head, run: "10", attempt: "1", baseSha: BASE, tree: TREE, authorFamily: "deepseek", verifierModel: "" }));
  const savedEnv = ["GH_TOKEN", "GITHUB_REPOSITORY", "HEAD_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "PR", "WORK"].map((key) => [key, process.env[key]]);
  Object.assign(process.env, { GH_TOKEN: "t", GITHUB_REPOSITORY: REPO, HEAD_SHA: head, GITHUB_RUN_ID: "10", GITHUB_RUN_ATTEMPT: "1", PR: "5", WORK: work });
  const pull = { state: "open", draft: false, base: { ref: "production", sha: BASE }, head: { sha: head, repo: { full_name: REPO } } };
  try {
    await postCommand({
      gh: (args) => {
        const url = String(args[1] ?? "");
        if (url === `repos/${REPO}/pulls/5`) return JSON.stringify(pull);
        if (url === `repos/${REPO}/commits/${head}/statuses`) return JSON.stringify([{ context: "pstack-verifier", creator: { login: "hypertask-runners[bot]" }, state: "pending", target_url: `https://github.com/${REPO}/actions/runs/10/attempts/1` }]);
        throw new Error(url);
      },
      token: "app-token",
      fetch: async (url, options) => { posted.push({ url: String(url), body: JSON.parse(options.body) }); return { ok: true }; },
    });
  } finally {
    for (const [key, value] of savedEnv) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
  const comment = posted.find((item) => item.url.includes("/comments"));
  assert.ok(comment.body.body.includes(marker));
});

test("the recheck reruns a green head whose recorded base is no longer its base", async () => {
  const { driftOf, selectDrift } = await recheck();
  const item = { number: 5, base: { sha: "a".repeat(40) }, head: { sha: "d".repeat(40) } };
  const comments = [{ user: { login: BOT }, body: markerBodies({ base: BASE }) }];
  assert.deepEqual(driftOf({ item, comments }), { number: 5, sha: "d".repeat(40), verifiedBase: BASE, base: "a".repeat(40) });
  assert.equal(driftOf({ item, comments: [{ user: { login: "someone" }, body: markerBodies({ base: BASE }) }] }), null);
  assert.equal(driftOf({ item: { ...item, base: { sha: BASE } }, comments }), null);
  assert.equal(selectDrift([{ number: 1, verifiedBase: BASE }]).length, 1);
  assert.equal(selectDrift([{ number: 1 }]).length, 0);
});
