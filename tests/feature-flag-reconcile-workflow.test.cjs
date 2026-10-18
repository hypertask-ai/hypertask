const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/feature-flag-gate.yml"), "utf8");
const reconciliation = workflow.split("  reconcile-open-pull-requests:")[1];
const startup = reconciliation.match(/        run: \|\n([\s\S]*?)          pages=/)[1]
  .replace(/^          /gm, "");

function runStartup(t, runnerTemp) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "flag-reconcile-test-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.RUNNER_TEMP;
  if (runnerTemp !== undefined) env.RUNNER_TEMP = runnerTemp(fixture);
  const result = spawnSync("bash", ["-e", "-c", `${startup}
    test -d "$gate_tmp" && test -w "$gate_tmp"
    printf '%s\\n' "$gate_tmp"
    stat -c '%a' "$gate_tmp"
  `], { env, encoding: "utf8" });
  return { result, parent: env.RUNNER_TEMP || "/tmp" };
}

function assertPrivateScratch({ result, parent }) {
  assert.equal(result.status, 0, result.stderr);
  const [scratch, mode] = result.stdout.trim().split("\n");
  assert.equal(path.dirname(scratch), parent);
  assert.match(path.basename(scratch), /^feature-flag-reconcile\.[A-Za-z0-9]{6}$/);
  assert.equal(mode, "700");
  assert.equal(fs.existsSync(scratch), false, "EXIT trap removes the scratch directory");
}

test("reconciliation creates private scratch in an existing runner temp directory", (t) => {
  assertPrivateScratch(runStartup(t, (fixture) => fixture));
});

test("reconciliation creates a missing runner temp parent, including spaces", (t) => {
  assertPrivateScratch(runStartup(t, (fixture) => path.join(fixture, "runner temp", "nested")));
});

test("reconciliation falls back to /tmp when RUNNER_TEMP is unset or empty", (t) => {
  assertPrivateScratch(runStartup(t));
  assertPrivateScratch(runStartup(t, () => ""));
});

test("reconciliation fails closed when the runner temp parent is a file", (t) => {
  const { result } = runStartup(t, (fixture) => {
    const file = path.join(fixture, "not-a-directory");
    fs.writeFileSync(file, "fixture");
    return file;
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /::error::Cannot create private feature-flag reconciliation scratch space\./);
});

test("reconciliation fails closed when mktemp cannot create private scratch", (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "flag-reconcile-mktemp-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture, "mktemp"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const result = spawnSync("bash", ["-e", "-c", startup], {
    env: { ...process.env, RUNNER_TEMP: fixture, PATH: `${fixture}:${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /::error::Cannot create private feature-flag reconciliation scratch space\./);
});

const singlePullRequest = workflow.split("  reconcile-open-pull-requests:")[0];
const waitingDescription = "feature-flag-gate is waiting for the run on the newer production commit";

function runWorkflow(t, { job = reconciliation, drift = false, missingHead = false, gateScript = 'console.log("ok");\n' } = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "flag-gate-drift-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const origin = path.join(fixture, "origin.git");
  const seed = path.join(fixture, "seed");
  const checkout = path.join(fixture, "checkout");
  const bin = path.join(fixture, "bin");
  fs.mkdirSync(bin);
  fs.mkdirSync(seed);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  Object.assign(env, {
    HOME: fixture,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    PATH: `${bin}:${process.env.PATH}`,
    RUNNER_TEMP: fixture,
    REPO: "fixture/repository",
    RUN_URL: "https://example.invalid/actions/runs/1",
    PR_NUMBER: "42",
    GITHUB_STEP_SUMMARY: path.join(fixture, "summary.md"),
    FIXTURE_PR: path.join(fixture, "pull.json"),
    FIXTURE_POSTS: path.join(fixture, "posts.jsonl"),
  });
  fs.writeFileSync(env.GITHUB_STEP_SUMMARY, "");
  fs.writeFileSync(env.FIXTURE_POSTS, "");

  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout}${result.stderr}`);
    return result.stdout.trim();
  }

  git(fixture, "init", "--bare", "--initial-branch=production", origin);
  git(seed, "init", "--initial-branch=production");
  const scripts = path.join(seed, ".github/scripts");
  const parser = path.join(scripts, "feature-flag-parser");
  fs.mkdirSync(parser, { recursive: true });
  fs.writeFileSync(path.join(scripts, "feature-flag-gate.mjs"), gateScript);
  for (const file of ["package.json", "package-lock.json"]) {
    fs.copyFileSync(path.join(__dirname, "../.github/scripts/feature-flag-parser", file), path.join(parser, file));
  }
  git(seed, "add", ".");
  git(seed, "commit", "-m", "production fixture");
  const base = git(seed, "rev-parse", "HEAD");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "origin", "production");
  git(seed, "switch", "-c", "pull-request");
  fs.writeFileSync(path.join(seed, "pull-request.txt"), "unique head\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "pull request fixture");
  const head = git(seed, "rev-parse", "HEAD");
  if (!missingHead) git(seed, "push", "origin", "HEAD:refs/pull/42/head");
  git(fixture, "clone", "--branch", "production", origin, checkout);
  if (drift) {
    git(seed, "switch", "production");
    fs.writeFileSync(path.join(seed, "new-production.txt"), "new policy\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "production moved after checkout");
    git(seed, "push", "origin", "production");
    assert.notEqual(git(checkout, "rev-parse", "HEAD"), git(seed, "rev-parse", "HEAD"));
  }
  env.EVENT_HEAD_SHA = head;
  fs.writeFileSync(env.FIXTURE_PR, JSON.stringify({
    number: 42,
    state: "open",
    title: "YPER4-442 [INFRA] fixture",
    base: { ref: "production", sha: base },
    head: { sha: head, repo: { full_name: env.REPO } },
    labels: [],
  }));
  fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const assert = require("node:assert/strict");
const args = process.argv.slice(2);
const pull = JSON.parse(fs.readFileSync(process.env.FIXTURE_PR, "utf8"));
const repo = "repos/" + process.env.REPO;
const endpoint = args.find((arg) => arg.startsWith("repos/"));
assert.equal(args[0], "api");
if (args.includes("POST")) {
  assert.equal(args[args.indexOf("-X") + 1], "POST");
  assert.equal(endpoint, repo + "/statuses/" + pull.head.sha);
  const payload = JSON.parse(fs.readFileSync(args[args.indexOf("--input") + 1], "utf8"));
  fs.appendFileSync(process.env.FIXTURE_POSTS, JSON.stringify({ endpoint, payload }) + "\\n");
  console.log("{}");
} else if (endpoint === repo + "/pulls?state=open&base=production&per_page=100") {
  assert.ok(args.includes("--paginate") && args.includes("--slurp"));
  console.log(JSON.stringify([[pull]]));
} else if (endpoint === repo + "/pulls/42") {
  console.log(JSON.stringify(pull));
} else if (endpoint === repo + "/commits/" + pull.head.sha + "/statuses?per_page=100") {
  console.log("[]");
} else {
  throw new Error("Unexpected gh arguments: " + JSON.stringify(args));
}
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    mkdir -p "$2/node_modules/typescript/lib"
    printf 'module.exports = {};\\n' >"$2/node_modules/typescript/lib/typescript.js"
    exit 0
  fi
  shift
done
exit 1
`, { mode: 0o755 });

  const script = job.match(/        run: \|\n([\s\S]*)/)[1].replace(/^          /gm, "");
  const result = spawnSync("bash", ["-e", "-c", script], {
    cwd: checkout,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  const posts = fs.readFileSync(env.FIXTURE_POSTS, "utf8").trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line).payload);
  return { result, output, posts };
}

test("reconcile drift: production moved mid-run posts pending and exits 0", (t) => {
  const { result, output, posts } = runWorkflow(t, { drift: true });
  assert.equal(result.status, 0, output);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].state, "pending");
  assert.equal(posts[0].description, waitingDescription);
  assert.doesNotMatch(output, /infrastructure failure/);
  assert.doesNotMatch(output, /::error::/);
  assert.match(output, /Trusted production checkout drifted; a later event will re-evaluate with current policy\./);
  assert.ok(posts.every((post) => post.state !== "success"));
});

test("single-PR drift: production moved mid-run posts pending and exits 0", (t) => {
  const { result, output, posts } = runWorkflow(t, { job: singlePullRequest, drift: true });
  assert.equal(result.status, 0, output);
  assert.equal(posts.length, 2);
  assert.equal(posts.at(-1).state, "pending");
  assert.equal(posts.at(-1).description, waitingDescription);
  assert.doesNotMatch(output, /::error::/);
  assert.match(output, /Trusted production checkout drifted; a later event will re-evaluate with current policy\./);
  assert.ok(posts.every((post) => post.state !== "success"));
});

test("drift guard: a failed production fetch still fails the reconcile run", (t) => {
  const { result, output, posts } = runWorkflow(t, { missingHead: true });
  assert.equal(result.status, 2, output);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].state, "error");
  assert.match(output, /infrastructure failure\(s\)/);
});

test("drift guard: no drift still posts success", (t) => {
  const { result, output, posts } = runWorkflow(t);
  assert.equal(result.status, 0, output);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].state, "success");
  assert.equal(posts[0].description, "ok");
});

test("drift guard: an unexpected gate exit code is an error, never pending", (t) => {
  for (const job of [reconciliation, singlePullRequest]) {
    const { result, output, posts } = runWorkflow(t, { job, gateScript: "process.exit(3);\n" });
    assert.equal(result.status, 2, output);
    assert.equal(posts.at(-1).state, "error");
    assert.ok(posts.every((post) => post.description !== waitingDescription));
  }
});
