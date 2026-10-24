const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/feature-flag-gate.yml"), "utf8");
const reconciliation = workflow.split("  reconcile-open-pull-requests:")[1];
const startup = reconciliation.match(/        run: \|\n(          set -uo pipefail[\s\S]*?)          pages=/)[1]
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

function featureFlagStatus(pull, overrides = {}) {
  const labels = JSON.stringify((pull.labels ?? []).map((label) => label.name).sort());
  const titleHash = createHash("sha256").update(`${pull.title}\n${labels}`).digest("hex").slice(0, 16);
  return {
    context: "feature-flag-gate", state: "success", description: "ok", updated_at: new Date().toISOString(),
    target_url: `https://example.invalid/actions/runs/previous#ffg=${pull.base.sha}.${titleHash}`,
    ...overrides,
  };
}

function runWorkflow(t, {
  job = reconciliation, drift = false, missingHead = false, apiFailure,
  gateScript = 'console.log("ok");\n', statuses = () => ({}), sharedHead = false,
  refreshedPull = (pull) => pull, freshSharedHead = false, forkHead = false,
} = {}) {
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
    JOB_STARTED_AT: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    PR_NUMBER: "42",
    GITHUB_STEP_SUMMARY: path.join(fixture, "summary.md"),
    FIXTURE_PR: path.join(fixture, "pull.json"),
    FIXTURE_STATUSES: path.join(fixture, "statuses.json"),
    FIXTURE_CURRENT_PR: path.join(fixture, "current-pull.json"),
    FIXTURE_SHARED_HEAD: String(sharedHead),
    FIXTURE_FRESH_SHARED_HEAD: String(freshSharedHead),
    FIXTURE_POSTS: path.join(fixture, "posts.jsonl"),
    FIXTURE_API_FAILURE: JSON.stringify(apiFailure || null),
    FIXTURE_API_CALLS: path.join(fixture, "api-calls.jsonl"),
  });
  fs.writeFileSync(env.GITHUB_STEP_SUMMARY, "");
  fs.writeFileSync(env.FIXTURE_POSTS, "");
  fs.writeFileSync(env.FIXTURE_API_CALLS, "");

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
  for (const file of ["github-api-retry.sh", "github-rate-limit.mjs"]) {
    fs.copyFileSync(path.join(__dirname, "../.github/scripts", file), path.join(scripts, file));
  }
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
  const pull = {
    number: 42,
    state: "open",
    title: "YPER4-442 [INFRA] fixture",
    base: { ref: "production", sha: base },
    head: { sha: head, repo: { full_name: forkHead ? "someone/fork" : env.REPO } },
    labels: [],
  };
  fs.writeFileSync(env.FIXTURE_PR, JSON.stringify(pull));
  fs.writeFileSync(env.FIXTURE_STATUSES, JSON.stringify(statuses(pull)));
  fs.writeFileSync(env.FIXTURE_CURRENT_PR, JSON.stringify(refreshedPull(pull)));
  fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const assert = require("node:assert/strict");
const args = process.argv.slice(2);
const pull = JSON.parse(fs.readFileSync(process.env.FIXTURE_PR, "utf8"));
const repo = "repos/" + process.env.REPO;
const endpoint = args.find((arg) => arg.startsWith("repos/"));
assert.equal(args[0], "api");
const failure = JSON.parse(process.env.FIXTURE_API_FAILURE);
const previous = fs.readFileSync(process.env.FIXTURE_API_CALLS, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse);
fs.appendFileSync(process.env.FIXTURE_API_CALLS, JSON.stringify({ endpoint, args }) + "\\n");
if (failure && (!failure.endpoint || endpoint.includes(failure.endpoint)) &&
    (!failure.method || args.includes(failure.method)) &&
    (!failure.after || previous.filter((call) => call.endpoint === endpoint).length >= failure.after) &&
    (!failure.once || !previous.some((call) => call.endpoint === endpoint))) {
  console.log("HTTP/2.0 " + failure.status + " Forbidden\\n" +
    (failure.rate ? "X-Ratelimit-Remaining: 0\\nX-Ratelimit-Reset: " + Math.floor(Date.now() / 1000 + failure.reset) + "\\n" : "") +
    "\\n" + JSON.stringify({ message: failure.rate ? "API rate limit exceeded" : "Forbidden" }));
  console.error("gh: HTTP " + failure.status);
  process.exit(1);
}
console.log("HTTP/2.0 200 OK\\nContent-Type: application/json\\n");
if (args.includes("POST")) {
  assert.equal(args[args.indexOf("-X") + 1], "POST");
  assert.equal(endpoint, repo + "/statuses/" + pull.head.sha);
  const payload = JSON.parse(fs.readFileSync(args[args.indexOf("--input") + 1], "utf8"));
  fs.appendFileSync(process.env.FIXTURE_POSTS, JSON.stringify({ endpoint, payload }) + "\\n");
  console.log("{}");
} else if (endpoint === repo + "/pulls?state=open&base=production&per_page=100") {
  assert.ok(args.includes("--paginate") && args.includes("--slurp"));
  const shared = process.env.FIXTURE_SHARED_HEAD === "true" ||
    (process.env.FIXTURE_FRESH_SHARED_HEAD === "true" && previous.some((call) => call.endpoint === endpoint));
  console.log(JSON.stringify([shared ? [pull, { ...pull, number: 43 }] : [pull]]));
} else if (endpoint === repo + "/pulls/42" || endpoint === repo + "/pulls/43") {
  const current = JSON.parse(fs.readFileSync(process.env.FIXTURE_CURRENT_PR, "utf8"));
  console.log(JSON.stringify({ ...current, number: endpoint.endsWith("/43") ? 43 : 42 }));
} else if (endpoint === repo + "/commits/" + pull.head.sha + "/statuses?per_page=100") {
  const statuses = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATUSES, "utf8"));
  console.log(JSON.stringify(statuses[pull.head.sha] || []));
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

  const script = job.match(/        run: \|\n(          set -uo pipefail[\s\S]*)/)[1].replace(/^          /gm, "");
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
  const calls = fs.readFileSync(env.FIXTURE_API_CALLS, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  return { result, output, posts, calls, pull };
}

for (const state of ["success", "failure"]) {
  test(`reconcile: unchanged ${state} fingerprint now skips with exactly one per-PR read and no POST`, (t) => {
    const { result, output, posts, calls, pull } = runWorkflow(t, {
      statuses: (pull) => ({ [pull.head.sha]: [
        { context: "another-gate", state: "pending" },
        featureFlagStatus(pull, { state }),
      ] }),
      gateScript: 'throw new Error("unchanged PR must not be evaluated");\n',
    });
    assert.equal(result.status, 0, output);
    assert.match(output, /skip #42: unchanged since its last status under 30 minutes ago/);
    assert.match(output, /evaluated 0, skipped 1/);
    assert.deepEqual(posts, []);
    assert.deepEqual(calls.map((call) => call.endpoint), [
      "repos/fixture/repository/pulls?state=open&base=production&per_page=100",
      `repos/fixture/repository/commits/${pull.head.sha}/statuses?per_page=100`,
    ]);
  });
}

test("reconcile: a fork PR with a matching recent success is still judged and refused", (t) => {
  const { result, output, posts } = runWorkflow(t, {
    forkHead: true,
    statuses: (pull) => ({ [pull.head.sha]: [featureFlagStatus(pull)] }),
  });
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /skip #42/);
  assert.match(output, /evaluated 1, skipped 0/);
  assert.equal(posts.at(-1).state, "failure");
  assert.match(posts.at(-1).description, /Fork pull requests require owner review/);
});

for (const change of ["base", "title", "head", "error", "pending", "missing fingerprint", "old format", "red older than 30 minutes", "labels"]) {
  test(`reconcile: ${change} still evaluates and refreshes the fingerprint without another status read`, (t) => {
    const { result, output, posts, calls, pull } = runWorkflow(t, {
      statuses: (pull) => {
        const prior = structuredClone(pull);
        if (change === "base") prior.base.sha = "a".repeat(40);
        if (change === "title") prior.title += " changed";
        if (change === "labels") prior.labels = [{ name: "AI CHAT" }];
        if (change === "head") prior.head.sha = "b".repeat(40);
        const status = featureFlagStatus(prior);
        if (change === "error" || change === "pending") status.state = change;
        if (change === "missing fingerprint") status.target_url = null;
        if (change === "old format") status.target_url = "https://example.invalid/actions/runs/previous";
        if (change === "red older than 30 minutes") {
          status.state = "failure";
          status.updated_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();
        }
        return { [prior.head.sha]: [status] };
      },
    });
    assert.equal(result.status, 0, output);
    assert.match(output, /evaluated 1, skipped 0/);
    assert.doesNotMatch(output, /skip #42/);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].state, "success");
    assert.equal(posts[0].description, "ok");
    assert.equal(new URL(posts[0].target_url).hash, new URL(featureFlagStatus(pull).target_url).hash);
    assert.equal(calls.filter((call) => call.endpoint.includes("/commits/")).length, 1);
    assert.equal(calls.filter((call) => call.endpoint.endsWith("/pulls/42")).length, 1);
    assert.equal(calls.filter((call) => call.endpoint.includes("/pulls?")).length, 2);
  });
}

test("reconcile: newest context status wins over an older matching success", (t) => {
  const { result, output, posts } = runWorkflow(t, {
    statuses: (pull) => ({ [pull.head.sha]: [
      featureFlagStatus(pull, { state: "pending" }), featureFlagStatus(pull),
    ] }),
  });
  assert.equal(result.status, 0, output);
  assert.match(output, /evaluated 1, skipped 0/);
  assert.equal(posts[0].state, "success");
});

for (const state of ["success", "failure"]) {
  test(`reconcile: shared-head PRs still refuse a matching ${state} fingerprint`, (t) => {
    const { result, output, posts, calls } = runWorkflow(t, {
      sharedHead: true,
      statuses: (pull) => ({ [pull.head.sha]: [featureFlagStatus(pull, { state })] }),
    });
    assert.equal(result.status, 0, output);
    assert.match(output, /evaluated 2, skipped 0/);
    assert.equal(posts.length, 2);
    assert.ok(posts.every((post) => post.state === "failure" && /shared by multiple/.test(post.description)));
    assert.equal(calls.filter((call) => call.endpoint.includes("/commits/")).length, 2);
  });
}

test("reconcile: a now-unique head recovers from its earlier shared-head failure", (t) => {
  const { result, output, posts } = runWorkflow(t, {
    statuses: (pull) => ({ [pull.head.sha]: [featureFlagStatus(pull, {
      state: "failure",
      description: "This head commit is shared by multiple open production pull requests; use a unique head commit.",
    })] }),
  });
  assert.equal(result.status, 0, output);
  assert.match(output, /evaluated 1, skipped 0/);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].state, "success");
});

test("reconcile: evaluated PR still rechecks current metadata before publishing", (t) => {
  const { result, output, posts } = runWorkflow(t, {
    refreshedPull: (pull) => ({ ...pull, title: pull.title + " changed" }),
  });
  assert.equal(result.status, 0, output);
  assert.match(output, /changed during reconciliation/);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].state, "error");
  assert.match(posts[0].description, /waiting for the updated pull request/);
});

test("reconcile: evaluated PR still rechecks fresh shared heads before publishing", (t) => {
  const { result, output, posts } = runWorkflow(t, { freshSharedHead: true });
  assert.equal(result.status, 0, output);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].state, "failure");
  assert.match(posts[0].description, /shared by multiple/);
});

test("per-PR: final verdict posts the current base/title fingerprint and unchanged description", (t) => {
  const { result, output, posts, pull } = runWorkflow(t, { job: singlePullRequest });
  assert.equal(result.status, 0, output);
  assert.equal(posts.length, 2);
  assert.equal(posts.at(-1).state, "success");
  assert.equal(posts.at(-1).description, "ok");
  assert.equal(posts.at(-1).target_url,
    "https://example.invalid/actions/runs/1" + new URL(featureFlagStatus(pull).target_url).hash);
});

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

for (const job of [reconciliation, singlePullRequest]) {
  const name = job === reconciliation ? 'reconcile' : 'per-PR';
  test(`${name}: long rate limit skips the pass with exit 0 and no error statuses`, (t) => {
    const { result, output, posts, calls } = runWorkflow(t, {
      job, apiFailure: { status: 403, rate: true, reset: 3600 },
    });
    assert.equal(result.status, 0, output);
    assert.match(output, /::warning::skipped: GitHub rate limited until .*next push or pull request event reconciles again/);
    assert.doesNotMatch(output, /::error::|infrastructure failure/);
    assert.deepEqual(posts, []);
    assert.equal(calls.length, 1, 'exhaustion stops the whole shell, including pending publication');
  });

  test(`${name}: short GET reset now allowed then publishes the ordinary verdict`, (t) => {
    const { result, output, posts } = runWorkflow(t, {
      job, apiFailure: { endpoint: '/pulls?', status: 429, rate: true, reset: 0, once: true },
    });
    assert.equal(result.status, 0, output);
    assert.match(output, /rate limited; waiting 1s until reset/);
    assert.equal(posts.at(-1).state, 'success');
    assert.ok(posts.every((post) => post.state !== 'error'));
  });

  test(`${name}: rate-limited verdict POST skips immediately without a second POST`, (t) => {
    const { result, output, posts, calls } = runWorkflow(t, {
      job, apiFailure: { method: 'POST', status: 429, rate: true, reset: 0, after: job === singlePullRequest ? 1 : 0 },
    });
    assert.equal(result.status, 0, output);
    assert.match(output, /::warning::skipped: GitHub rate limited until/);
    assert.doesNotMatch(output, /waiting .*until reset|::error::/);
    assert.equal(calls.filter((call) => call.args.includes('POST')).length, job === singlePullRequest ? 2 : 1);
    assert.ok(posts.every((post) => post.state === 'pending'), 'no stale verdict published');
  });

  for (const endpoint of ['/pulls/42', '/pulls?', '/statuses/']) {
    test(`${name}: evaluation exit 2 before rate limit at ${endpoint} remains exit 2`, (t) => {
      const after = job === singlePullRequest || endpoint === '/pulls?' ? 1 : 0;
      const { result, output, posts } = runWorkflow(t, {
        job, gateScript: 'process.exit(2);\n',
        apiFailure: { endpoint, after, status: 403, rate: true, reset: 3600 },
      });
      assert.equal(result.status, 2, output);
      assert.match(output, /::warning::skipped: GitHub rate limited until/);
      assert.ok(posts.every((post) => post.state === 'pending'), 'evaluation error precedes the skip, not an error-status post');
    });
  }

  for (const status of [403, 404, 500]) {
    test(`${name}: ordinary HTTP ${status} still refused`, (t) => {
      const { result, output } = runWorkflow(t, { job, apiFailure: { status } });
      assert.equal(result.status, 2, output);
      assert.match(output, /::error::/);
      assert.doesNotMatch(output, /skipped:|waiting .*until reset/);
    });
  }
}

for (const endpoint of ['/commits/', '/pulls/42', '/statuses/']) {
  test(`reconcile: rate limit at ${endpoint} exits the parent shell without publishing an error`, (t) => {
    const { result, output, posts } = runWorkflow(t, {
      apiFailure: { endpoint, status: 403, rate: true, reset: 3600 },
    });
    assert.equal(result.status, 0, output);
    assert.match(output, /::warning::skipped: GitHub rate limited/);
    assert.ok(posts.every((post) => post.state !== 'error'));
    assert.doesNotMatch(output, /::error::|infrastructure failure/);
  });
}

test('all feature-flag API calls use the wrapper in the main shell and concurrency stays serialized', () => {
  assert.doesNotMatch(workflow, /\bgh api\b|\$\(gh_api\b/);
  assert.equal((workflow.match(/source \.github\/scripts\/github-api-retry\.sh/g) || []).length, 2);
  assert.match(workflow, /group: feature-flag-gate-production\s*cancel-in-progress: false/);
  assert.doesNotMatch(singlePullRequest, /cancel-in-progress: true/);
});

test('initial and drift pending publications use newest-wins guards in both jobs', () => {
  const perPrPublisher = singlePullRequest.split('          publish_status_if_current() {')[1]
    .split('          publish_error_status() {')[0];
  const reconcilePublisher = reconciliation.split('          publish_status_if_changed() {')[1]
    .split('          publish_reconciliation_error() {')[0];
  for (const publisher of [perPrPublisher, reconcilePublisher]) {
    assert.match(publisher, /GH_API_NO_WAIT=1 gh_api "repos\/\$REPO\/commits\/\$head_sha\/statuses\?per_page=100"/);
    assert.match(publisher, /--arg job_started_at "\$JOB_STARTED_AT"/);
    assert.match(publisher, /map\(select\(\.context == "feature-flag-gate"\)\)\[0\] as \$current \|/);
    assert.match(publisher, /\(\$current\.state == "success" or \$current\.state == "failure"\) and\s+\(\$current\.created_at \/\/ ""\) > \$job_started_at/);
    assert.match(publisher, /newer final feature-flag-gate status exists"\s+return 0/);
    assert.ok(publisher.indexOf('--arg job_started_at') < publisher.indexOf('gh_api -X POST'));
  }
  assert.match(singlePullRequest, /if ! publish_status_if_current "\$pending_payload"; then/);
  assert.match(singlePullRequest, /elif \[ "\$result" -eq 3 \]; then\s+state=pending[\s\S]*?if ! publish_status_if_current "\$payload"; then/);
  assert.match(reconciliation, /elif \[ "\$result" -eq 3 \]; then\s+state=pending[\s\S]*?if ! publish_status_if_changed "\$head_sha" "\$payload" "\$statuses_file"; then/);
  assert.match(reconcilePublisher, /if \[ "\$state" = "pending" \]; then\s+statuses_file="\$gate_tmp\/pending-latest-statuses\.json"[\s\S]*?gh_api[^\n]*>"\$statuses_file" \|\| return 1/);
  assert.match(perPrPublisher, /gh_api "repos\/\$REPO\/pulls\/\$PR_NUMBER"[^\n]*\|\| return 1/);
  assert.match(perPrPublisher, /'\.head\.sha' "\$gate_tmp\/status-pr\.json"\)" != "\$head_sha"[\s\S]*?return 0/);
});

test('a genuine evaluation error is not hidden by rate limiting its error-status post', (t) => {
  const { result, output, posts } = runWorkflow(t, {
    gateScript: 'process.exit(2);\n',
    apiFailure: { endpoint: '/statuses/', status: 403, rate: true, reset: 3600 },
  });
  assert.equal(result.status, 2, output);
  assert.match(output, /::warning::skipped: GitHub rate limited/);
  assert.deepEqual(posts, []);
});
