const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const script = resolve(__dirname, "../.github/scripts/verify-required-check-settings.mjs");
const base = "a".repeat(40);
const head = "b".repeat(40);
const contexts = [
  "app-smoke", "ci-tests", "ai-review", "claude-review", "feature-flag-gate",
  "next-public-secrets", "pr-title", "secret-scan", "browser-smoke", "premerge-evidence",
];
const endpoints = [
  "repos/test/repo",
  "repos/test/repo/rulesets?per_page=100",
  "repos/test/repo/rulesets/42",
];

function runSettings({
  event = "pull_request", file = ".github/workflows/ci-tests.yml",
  diffStatus = 0, fetchStatus = 0, httpStatus = 200, resetSeconds = 0,
  liveContexts = contexts, proof = null,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "required-check-settings-"));
  const log = join(directory, "calls");
  const eventPath = join(directory, "event.json");
  const proofPath = join(directory, "proof/last-verified.json");
  const outputPath = join(directory, "step-output");
  const summaryPath = join(directory, "step-summary");
  const logArgs = `printf '%s' "$tool" >> "$CALL_LOG"
printf '\\t%s' "$@" >> "$CALL_LOG"
printf '\\n' >> "$CALL_LOG"
`;
  try {
    writeFileSync(log, "");
    writeFileSync(outputPath, "");
    writeFileSync(summaryPath, "");
    if (proof) {
      mkdirSync(join(directory, "proof"), { recursive: true });
      writeFileSync(proofPath, JSON.stringify(proof));
    }
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }));
    writeFileSync(join(directory, "git"), `#!/bin/sh
set -eu
tool=git
${logArgs}case "$1" in
  fetch) exit "$FETCH_STATUS" ;;
  diff) printf '%s\\0' "$DIFF_FILE"; exit "$DIFF_STATUS" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(directory, "sleep"), `#!/bin/sh
set -eu
tool=sleep
${logArgs}exit 0
`, { mode: 0o755 });
    writeFileSync(join(directory, "gh"), `#!/bin/sh
set -eu
tool=gh
${logArgs}count=0
if [ -f "$GH_COUNT" ]; then read -r count < "$GH_COUNT"; fi
count=$((count + 1))
printf '%s\\n' "$count" > "$GH_COUNT"
[ "$1" = api ] && [ "$2" = --include ] || exit 99
if [ "$count" = 1 ] && [ "$HTTP_STATUS" != 200 ]; then
  printf 'HTTP/2.0 %s Error\\r\\n' "$HTTP_STATUS"
  if [ "$RESET_SECONDS" != 0 ]; then
    printf 'x-ratelimit-remaining: 0\\r\\nx-ratelimit-reset: %s\\r\\n' "$RESET_AT"
  fi
  printf '\\r\\n{"message":"forbidden or missing"}\\n'
  exit 1
fi
case "$3" in
  repos/test/repo) body="$REPOSITORY_JSON" ;;
  'repos/test/repo/rulesets?per_page=100') body="$RULESETS_JSON" ;;
  repos/test/repo/rulesets/42) body="$RULESET_JSON" ;;
  *) exit 99 ;;
esac
printf 'HTTP/2.0 200 OK\\r\\ncontent-type: application/json\\r\\n\\r\\n%s\\n' "$body"
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: directory,
        REPO: "test/repo",
        GITHUB_EVENT_NAME: event,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        SETTINGS_PROOF: proofPath,
        CALL_LOG: log,
        GH_COUNT: join(directory, "gh-count"),
        DIFF_FILE: file,
        DIFF_STATUS: String(diffStatus),
        FETCH_STATUS: String(fetchStatus),
        HTTP_STATUS: String(httpStatus),
        RESET_SECONDS: String(resetSeconds),
        RESET_AT: String(Math.floor(Date.now() / 1000) + resetSeconds),
        REPOSITORY_JSON: JSON.stringify({ default_branch: "production" }),
        RULESETS_JSON: JSON.stringify([{ id: 42, name: "production-required-checks", enforcement: "active" }]),
        RULESET_JSON: JSON.stringify({
          target: "branch",
          conditions: { ref_name: { include: ["refs/heads/production"], exclude: [] } },
          rules: [{ type: "required_status_checks", parameters: {
            required_status_checks: liveContexts.map((context) => ({ context })),
          } }],
        }),
      },
    });
    assert.ifError(result.error);
    const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
    const stored = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, "utf8")) : null;
    const stepOutput = readFileSync(outputPath, "utf8");
    const stepSummary = readFileSync(summaryPath, "utf8");
    return { ...result, output: result.stdout + result.stderr, calls, stored, stepOutput, stepSummary };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertVerified(result, expectedEndpoints = endpoints) {
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Required-check settings verified:/);
  assert.doesNotMatch(result.output, /skipping settings API reads|::error::|not verified this run/);
  assert.deepEqual(result.calls.filter(([tool]) => tool === "gh"),
    expectedEndpoints.map((endpoint) => ["gh", "api", "--include", endpoint]));
  assert.deepEqual(result.stored, {
    repository: "test/repo",
    defaultBranch: "production",
    rulesetId: 42,
    contexts: [...contexts].sort(),
    verifiedAt: result.stored.verifiedAt,
  });
  assert.ok(Number.isFinite(Date.parse(result.stored.verifiedAt)), result.stored.verifiedAt);
  assert.equal(result.stepOutput, "verified=true\n");
}

function assertRejected(result) {
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /::error::/);
  assert.doesNotMatch(result.output, /Required-check settings verified:|skipping settings API reads|not verified this run/);
  assert.deepEqual(result.calls.filter(([tool]) => tool === "sleep"), []);
}

function assertNotVerified(result) {
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Required-check settings: not verified this run\./);
  assert.match(result.output, /::warning::Required-check settings were not verified this run:/);
  assert.doesNotMatch(result.output, /::error::|Required-check settings verified:/);
  assert.equal(result.stepOutput, "verified=false\n");
}

for (const file of [".github/workflows/ci-tests.yml", "docs/ci-policy.yml"]) {
  test(`pull_request changing ${file} still runs the full settings check`, () => {
    const result = runSettings({ file });
    assertVerified(result);
    assert.deepEqual(result.calls.filter(([tool]) => tool === "git"), [
      ["git", "fetch", "--no-tags", "--depth=1", "origin", base, head],
      ["git", "diff", "--name-only", "--no-renames", "-z", base, head],
    ]);
  });
}

test("pull_request with only app code skips all settings API reads", () => {
  const result = runSettings({ file: "src/app/page.tsx" });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /PR has no CI-policy changes; skipping settings API reads/);
  assert.doesNotMatch(result.output, /Required-check settings verified:|::error::/);
  assert.deepEqual(result.calls.map(([tool]) => tool), ["git", "git"]);
});

for (const event of ["schedule", "workflow_dispatch"]) {
  test(`${event} runs the full settings check without git discovery`, () => {
    const result = runSettings({ event });
    assertVerified(result);
    assert.deepEqual(result.calls.filter(([tool]) => tool === "git"), []);
  });
}

test("push always runs the full settings check", () => {
  const result = runSettings({ event: "push", file: "src/app/page.tsx" });
  assertVerified(result);
  assert.deepEqual(result.calls.filter(([tool]) => tool === "git"), []);
});

for (const failure of ["diffStatus", "fetchStatus"]) {
  test(`git ${failure} failure verifies settings fail-closed`, () => {
    const result = runSettings({ file: "src/app/page.tsx", [failure]: 1 });
    assertVerified(result);
    assert.match(result.output, /changed files unknown; verifying \(fail-closed\)/);
    assert.equal(result.calls.filter(([tool]) => tool === "git").length, failure === "fetchStatus" ? 1 : 2);
  });
}

test("403 rate limit waits until reset then verifies settings", () => {
  const result = runSettings({ httpStatus: 403, resetSeconds: 5 });
  assertVerified(result, [endpoints[0], ...endpoints]);
  assert.match(result.output, /rate limited, waiting \d+s until reset/);
  const sleeps = result.calls.filter(([tool]) => tool === "sleep");
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0].length, 2);
  assert.ok(Number(sleeps[0][1]) >= 1 && Number(sleeps[0][1]) <= 5);
  assert.deepEqual(result.calls.map(([tool]) => tool), ["git", "git", "gh", "sleep", "gh", "gh", "gh"]);
});

test("403 reset beyond the wait cap keeps the last verified value instead of failing the run", () => {
  const verifiedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const result = runSettings({
    httpStatus: 403, resetSeconds: 4000,
    proof: { repository: "test/repo", defaultBranch: "production", rulesetId: 42, contexts: [...contexts].sort(), verifiedAt },
  });
  assertNotVerified(result);
  assert.match(result.output, /not a test failure: wait cap exceeded.*settings were not verified/);
  assert.match(result.output, new RegExp(`Last verified settings: ${verifiedAt} \\(3h \\d+m ago\\)`));
  assert.match(result.output, /ruleset 42, required checks app-smoke, ai-review, browser-smoke, ci-tests, claude-review/);
  assert.match(result.stepSummary, /### Required-check settings: not verified this run/);
  assert.match(result.stepSummary, /An empty GitHub API allowance is not a settings failure/);
  assert.deepEqual(result.stored.contexts, [...contexts].sort());
  assert.equal(result.stored.verifiedAt, verifiedAt);
  assert.equal(result.calls.filter(([tool]) => tool === "gh").length, 1);
});

test("403 reset beyond the wait cap with no stored proof reports that nothing was ever verified", () => {
  const result = runSettings({ httpStatus: 403, resetSeconds: 4000 });
  assertNotVerified(result);
  assert.match(result.output, /Last verified settings: none stored/);
  assert.equal(result.calls.filter(([tool]) => tool === "gh").length, 1);
});

test("a stored proof with an unreadable timestamp is reported as never verified", () => {
  const result = runSettings({ httpStatus: 403, resetSeconds: 4000, proof: { rulesetId: 42 } });
  assertNotVerified(result);
  assert.match(result.output, /Last verified settings: none stored/);
});

for (const httpStatus of [404, 403]) {
  test(`non-rate-limit HTTP ${httpStatus} fails without a pass`, () => {
    const result = runSettings({ httpStatus });
    assertRejected(result);
    assert.match(result.output, new RegExp(`HTTP ${httpStatus}.*not a rate limit`));
    assert.equal(result.calls.filter(([tool]) => tool === "gh").length, 1);
  });
}

test("different live required contexts fail verification", () => {
  const result = runSettings({ liveContexts: contexts.filter((context) => context !== "ci-tests") });
  assertRejected(result);
  assert.match(result.output, /Live required checks do not match docs\/ci-policy.yml/);
  assert.equal(result.calls.filter(([tool]) => tool === "gh").length, 3);
});
