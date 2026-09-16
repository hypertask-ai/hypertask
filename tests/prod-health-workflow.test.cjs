// HTPR-5467 — behavioral tests for the prod-health workflow's challenge/rollback
// decision. Follows the same pattern as tests/automerge-workflow.test.cjs: the
// health job's `run: |` block is extracted from the workflow YAML, de-indented,
// and executed as a bash script with stub `curl`/`sleep` binaries on the PATH so
// the shell decision logic is exercised for real rather than asserted as source
// text. `jq`/`seq`/`grep`/`awk` are the real system tools.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

// Extract the FIRST `run: |` block (the `health` job). The block scalar ends at
// the first non-empty line indented no deeper than the `run:` key (8 spaces),
// which is where the `drift` job begins.
async function workflowScript() {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const marker = "        run: |\n";
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, "health job run block not found");
  const lines = workflow.slice(start + marker.length).split("\n");
  const block = [];
  for (const line of lines) {
    if (line === "") {
      block.push("");
      continue;
    }
    const indent = (line.match(/^ */) || [""])[0].length;
    if (indent <= 8) break; // next top-level key (drift:)
    block.push(line.slice(10));
  }
  return block
    .join("\n")
    // The runner substitutes ${{ github.repository }} before bash parses the
    // script; it only survives in notify text, so pin it to a fixed string.
    .replaceAll("${{ github.repository }}", "test/repo");
}

test("drift can read workflow runs for the health-gate check", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const start = workflow.indexOf("\n  drift:");
  const next = workflow.indexOf("\n  core-actions:", start);
  const block = workflow.slice(start, next);
  assert.match(block, /actions: read/);
  assert.match(block, /cannot read prod-health runs/);
});

test("health and drift jobs cannot overlap", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  // Push and scheduled triggers share one workflow-level "prod-health" lock;
  // only a signed PostHog dispatch escapes into its own run-scoped group so
  // an alert is never queued behind a health run. Drift therefore needs no
  // job-level lock of its own: one named group cannot be held by a workflow
  // run and one of its own jobs at the same time, so a job-level "prod-health"
  // on drift would leave the job pending behind its parent run forever.
  assert.match(
    workflow,
    /^concurrency:\n(?:  #[^\n]*\n)*  group: \$\{\{ inputs\.posthog_payload != '' && format\('posthog-error-\{0\}', github\.run_id\) \|\| 'prod-health' \}\}\n  cancel-in-progress: false\n/m,
  );
  const driftStart = workflow.indexOf("\n  drift:");
  const nextJob = workflow.indexOf("\n  core-actions:", driftStart);
  assert.ok(driftStart !== -1 && nextJob !== -1);
  assert.doesNotMatch(workflow.slice(driftStart, nextJob), /concurrency:/);
});

// A stateful curl stub. Probe calls to app.hypertask.ai consume one token each
// from HC_SEQUENCE; version/Vercel/Telegram calls are served deterministically.
const CURL_STUB = `#!/usr/bin/env bash
set -u
out=""
hdrs=""
want=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -s|-L) shift ;;
    -o) out="$2"; shift 2 ;;
    -D) hdrs="$2"; shift 2 ;;
    -w) want="$2"; shift 2 ;;
    -X) shift 2 ;;
    -H) shift 2 ;;
    --max-time) shift 2 ;;
    -d) shift 2 ;;
    --data-urlencode) shift 2 ;;
    *)
      case "$1" in
        https://*) url="$1" ;;
      esac
      shift
      ;;
  esac
done

body=""
status="200"
headers=""

case "$url" in
  https://api.vercel.com/v6/deployments*)
    body=\$(printf '{"deployments":[{"uid":"deploy-current","state":"READY","meta":{"githubCommitSha":"%s"}},{"uid":"deploy-prev","state":"READY","meta":{"githubCommitSha":"other"}}]}' "\$SHA")
    ;;
  https://api.vercel.com/v10/projects/*/promote/*)
    printf '%s' "\$url" > "\$RUNNER_TEMP/promoted"
    body='{"ok":true}'
    ;;
  https://api.telegram.org/*)
    body='{"ok":true}'
    ;;
  https://app.hypertask.ai/api/version*)
    # After an alias repair promote, subsequent reads must see the SHA the
    # job is checking (HTPR-6511). Until then, HC_VERSION_SHA can lie.
    # HC_VERSION_RECHECK_SHA is returned after the wait loop (7th+ read)
    # so the promote-path race check can see a newer descendant.
    version_file="\$RUNNER_TEMP/hc-version-count"
    vidx=0
    if [ -f "\$version_file" ]; then vidx=\$(cat "\$version_file"); fi
    vidx=\$((vidx + 1))
    printf '%s' "\$vidx" > "\$version_file"
    if [ -f "\$RUNNER_TEMP/promoted" ]; then
      body=\$(printf '{"buildId":"%s"}' "\$SHA")
    elif [ "\$vidx" -ge 7 ] && [ -n "\${HC_VERSION_RECHECK_SHA:-}" ]; then
      body=\$(printf '{"buildId":"%s"}' "\$HC_VERSION_RECHECK_SHA")
    else
      body=\$(printf '{"buildId":"%s"}' "\${HC_VERSION_SHA:-\$SHA}")
    fi
    ;;
  https://app.hypertask.ai/api/ops/task-write-probe*|https://app.hypertask.ai/api/mcp/projects*|https://app.hypertask.ai/)
    count_file="\$RUNNER_TEMP/hc-count"
    idx=0
    if [ -f "\$count_file" ]; then idx=\$(cat "\$count_file"); fi
    idx=\$((idx + 1))
    printf '%s' "\$idx" > "\$count_file"
    token=\$(printf '%s' "\$HC_SEQUENCE" | awk -v n="\$idx" '{print \$n}')
    case "\$token" in
      challenge) status="403"; headers="x-vercel-mitigated: challenge"; body="<html>challenge</html>" ;;
      ok) status="200"; body="OK" ;;
      500) status="500"; body="server error" ;;
      broken) status="500"; body='{"success":false,"probe":{"status":"broken","error":"boom"}}' ;;
      healthy) status="200"; body='{"success":true,"probe":{"status":"healthy","rolledBack":true,"lockedTaskId":1,"probeRowId":"p"}}' ;;
      inconclusive) status="200"; body='{"success":false,"probe":{"status":"inconclusive","reason":"no task"}}' ;;
      misconfigured) status="503"; body='{"success":false,"probe":{"status":"misconfigured","reason":"probe fixture missing"}}' ;;
      # A connection failure (real curl exit 7) leaves the previous -o/-D file
      # untouched, so clear out/hdrs to skip writing and reproduce the stale-body
      # bug faithfully.
      connfail) status="000"; out=""; hdrs="" ;;
      healthy500) status="500"; body='{"success":true,"probe":{"status":"healthy","rolledBack":true,"lockedTaskId":1,"probeRowId":"p"}}' ;;
    esac
    ;;
esac

if [ -n "\$out" ] && [ "\$out" != "/dev/null" ]; then
  printf '%s' "\$body" > "\$out"
fi
if [ -n "\$hdrs" ]; then
  printf '%s\\n' "\$headers" > "\$hdrs"
fi
if [ -n "\$want" ]; then
  printf '%s' "\$status"
elif [ -z "\$out" ] || [ "\$out" = "/dev/stdout" ]; then
  printf '%s' "\$body"
fi
`;

async function runHealthCheck(hcSequence, extraEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "prod-health-workflow-"));
  const bin = join(directory, "bin");
  const runnerTemp = join(directory, "runner-temp");
  await mkdir(bin);
  await mkdir(runnerTemp);

  await writeFile(join(bin, "curl"), CURL_STUB);
  await writeFile(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  await chmod(join(bin, "curl"), 0o755);
  await chmod(join(bin, "sleep"), 0o755);

  try {
    const result = spawnSync("bash", ["-c", await workflowScript()], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        VERCEL_TOKEN: "stub-vercel-token",
        MCP_TOKEN: "stub-mcp-token",
        TG_TOKEN: "stub-tg-token",
        TG_CHAT: "stub-tg-chat",
        SHA: "c".repeat(40),
        PROJECT_ID: "prj_stub",
        TEAM_ID: "team_stub",
        RUNNER_TEMP: runnerTemp,
        GITHUB_OUTPUT: join(runnerTemp, "github-output"),
        HC_SEQUENCE: hcSequence,
        ...extraEnv,
      },
    });
    const promoted = await readFile(join(runnerTemp, "promoted"), "utf8").catch(
      () => null,
    );
    return { result, promoted };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// The bug (HTPR-5467): attempt 1 is Vercel-challenged, but attempt 3 returns an
// unchallenged broken verdict. A sticky `challenged` flag would exit 0 here; the
// fix must still roll production back.
test("an unchallenged broken response rolls back even after an earlier challenge", async () => {
  const { result, promoted } = await runHealthCheck(
    "challenge challenge challenge ok ok broken ok ok broken",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /rolled back to deploy-prev/);
  assert.doesNotMatch(result.stdout, /Bot-challenged responses only/);
  assert.ok(promoted, "rollback promote call was never made");
  assert.match(promoted, /\/promote\/deploy-prev/);
});

// The guarantee that must not be weakened: when every failed response was
// Vercel-challenged, the run never rolls back.
test("a genuinely challenged-only run never rolls back", async () => {
  const { result, promoted } = await runHealthCheck(
    "challenge challenge challenge challenge challenge challenge challenge challenge challenge",
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Bot-challenged responses only; skipping rollback/);
  assert.equal(promoted, null, "a challenged-only run must not promote");
});

// An unproven probe (reads pass, probe inconclusive) must also never roll back.
test("a read-passing inconclusive probe fails the job but never rolls back", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok inconclusive ok ok inconclusive ok ok inconclusive",
  );

  // Not healthy: the write path was never proven, so the gate must not go green.
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /Task-write probe inconclusive/);
  assert.equal(promoted, null, "an inconclusive probe must not promote");
});

// The bug (HTPR-5467, stale body): attempt 1's probe is healthy but the reads
// are challenged, so the loop continues. On attempt 2 the probe request fails to
// connect (curl prints 000) and — like real curl — leaves the previous -o file
// untouched. The stale healthy body must NOT count as healthy; the run must roll
// back off the definitive connection failure instead of exiting 0.
// An unprovisioned probe fixture must not warn forever: the write gate is not
// running, so the job fails loudly. It must still never roll back, because no
// rollback creates a fixture.
test("an unprovisioned probe fixture fails the job without rolling back", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok misconfigured ok ok misconfigured ok ok misconfigured",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /write gate is inactive/);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.equal(promoted, null, "a missing fixture must not promote");
});

// A setup problem must never mask a proven outage: an early misconfigured probe
// plus an unchallenged definitive failure standing on the final attempt still
// rolls back.
test("a missing fixture does not suppress rollback for a real final-attempt failure", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok misconfigured ok ok misconfigured ok 500 broken",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /rolled back to deploy-prev/);
  assert.ok(promoted, "a standing definitive failure must still promote");
});

// A challenge on an earlier attempt parses as http-403. A sticky run-wide
// "broken" flag would swallow the final attempt's inconclusive verdict and let
// the gate exit 0 with the write path unproven.
test("an earlier challenged probe does not let a final inconclusive probe pass", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok challenge ok ok inconclusive ok ok inconclusive",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /Task-write probe inconclusive/);
  assert.equal(promoted, null, "an inconclusive probe must not promote");
});

// The positive path: everything green exits 0, says so, and never promotes.
test("a fully healthy run exits clean and never rolls back", async () => {
  const { result, promoted } = await runHealthCheck("ok ok healthy");

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Production healthy/);
  assert.equal(promoted, null, "a healthy run must not promote");
});

test("a stale healthy probe body from an earlier attempt is not healthy", async () => {
  const { result, promoted } = await runHealthCheck(
    "challenge challenge healthy ok ok connfail ok ok connfail",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /rolled back to deploy-prev/);
  assert.ok(promoted, "rollback promote call was never made");
  assert.match(promoted, /\/promote\/deploy-prev/);
});

// The bug (HTPR-5467, non-200 verdict): a probe that answers HTTP 500 but whose
// body still carries probe.status=healthy must never count as healthy.
test("a non-200 probe response with a healthy-looking body is not healthy", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok healthy500 ok ok healthy500 ok ok healthy500",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /rolled back to deploy-prev/);
  assert.ok(promoted, "rollback promote call was never made");
  assert.match(promoted, /\/promote\/deploy-prev/);
});

// The bug (HTPR-5467, per-endpoint masking): a challenged homepage in the SAME
// attempt must not mask an unchallenged broken probe verdict. The old code
// grepped all three header files in one call, so a challenge on ANY endpoint
// excused the whole attempt and discarded the probe's broken verdict.
test("a challenged homepage does not mask an unchallenged broken probe in the same attempt", async () => {
  const { result, promoted } = await runHealthCheck(
    "challenge ok broken challenge ok broken challenge ok broken",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /rolled back to deploy-prev/);
  assert.ok(promoted, "rollback promote call was never made");
  assert.match(promoted, /\/promote\/deploy-prev/);
});

// Mirror case (HTPR-5467): a challenged probe must not mask an unchallenged
// non-200 API response in the same attempt.
test("a challenged probe does not mask an unchallenged non-200 API response in the same attempt", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok broken challenge ok broken challenge ok broken challenge",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /rolled back to deploy-prev/);
  assert.ok(promoted, "rollback promote call was never made");
  assert.match(promoted, /\/promote\/deploy-prev/);
});

// HTPR-5467 round-5: `unchallenged_failure` must be evaluated on the FINAL
// attempt, not sticky across attempts. Attempt 1 sees a transient unchallenged
// probe 500; attempts 2-3 are Vercel-challenged. The transient blip must NOT
// roll back the previous deployment, but the run must NOT report healthy either.
test("an unchallenged failure on an earlier attempt does not roll back when the final attempt is challenged", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok broken challenge challenge challenge challenge challenge challenge",
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.doesNotMatch(result.stdout, /rolled back to deploy-prev/);
  assert.match(result.stdout, /Earlier definitive failure not confirmed on final attempt/);
  assert.equal(promoted, null, "a transient earlier failure must not promote");
});

// The fix must not over-correct: a persistent unchallenged broken probe on every
// attempt (including the final one) still rolls back.
test("a persistent unchallenged broken probe across all attempts still rolls back", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok broken ok ok broken ok ok broken",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /rolled back to deploy-prev/);
  assert.ok(promoted, "rollback promote call was never made");
  assert.match(promoted, /\/promote\/deploy-prev/);
});

// HTPR-6511: a READY production deploy can miss the alias. /api/version keeps
// serving the previous commit. The health job used to error and stop; it must
// promote that READY deploy so the merge actually ships.
test("a READY deploy that missed the alias is promoted onto production", async () => {
  const { result, promoted } = await runHealthCheck("ok ok healthy", {
    HC_VERSION_SHA: "a".repeat(40),
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Production healthy/);
  assert.ok(promoted, "alias-repair promote was never made");
  assert.match(promoted, /\/promote\/deploy-current/);
});

async function driftScript() {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const heading = workflow.indexOf(
    "Compare the live production deployment against the production tip",
  );
  assert.notEqual(heading, -1, "drift job heading not found");
  const marker = "        run: |\n";
  const start = workflow.indexOf(marker, heading);
  assert.notEqual(start, -1, "drift job run block not found");
  const lines = workflow.slice(start + marker.length).split("\n");
  const block = [];
  for (const line of lines) {
    if (line === "") {
      block.push("");
      continue;
    }
    const indent = (line.match(/^ */) || [""])[0].length;
    if (indent <= 8) break;
    block.push(line.slice(10));
  }
  return block.join("\n");
}

const DRIFT_CURL_STUB = `#!/usr/bin/env bash
set -u
out=""
hdrs=""
want=""
url=""
method="GET"
while [ $# -gt 0 ]; do
  case "$1" in
    -s|-L) shift ;;
    -o) out="$2"; shift 2 ;;
    -D) hdrs="$2"; shift 2 ;;
    -w) want="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -H) shift 2 ;;
    --max-time) shift 2 ;;
    -d) shift 2 ;;
    --data-urlencode) shift 2 ;;
    *)
      case "$1" in
        https://*) url="$1" ;;
      esac
      shift
      ;;
  esac
done

body=""
status="200"
headers=""

case "$url" in
  https://app.hypertask.ai/api/version*)
    if [ -f "$RUNNER_TEMP/promoted" ]; then
      body=$(printf '{"buildId":"%s"}' "$DRIFT_TIP_SHA")
    else
      body=$(printf '{"buildId":"%s"}' "$DRIFT_LIVE_SHA")
    fi
    ;;
  https://api.vercel.com/v6/deployments*)
    # Latest READY can already be the tip while /api/version is stale
    # (HTPR-6511). The list still includes the tip so promote can find it.
    body=$(printf '{"deployments":[{"uid":"deploy-tip","state":"READY","meta":{"githubCommitSha":"%s"}},{"uid":"deploy-old","state":"READY","meta":{"githubCommitSha":"%s"}}]}' "$DRIFT_TIP_SHA" "$DRIFT_LIVE_SHA")
    ;;
  https://api.vercel.com/v9/projects*)
    body=$(printf '{"id":"prj_stub","targets":{"production":{"id":"deploy-old","meta":{"githubCommitSha":"%s"}}}}' "$DRIFT_LIVE_SHA")
    ;;
  https://api.vercel.com/v10/projects/*/promote/*)
    printf '%s' "$url" > "$RUNNER_TEMP/promoted"
    body='{"ok":true}'
    ;;
  https://api.github.com/repos/*/commits/*/status*)
    body=$(printf '{"statuses":[{"context":"prod-health-gate","state":"%s"}]}' "\${DRIFT_HEALTH_GATE:-success}")
    ;;
  https://api.github.com/repos/*/actions/workflows/prod-health.yml/runs*)
    body=$(printf '{"workflow_runs":[{"status":"completed","conclusion":"%s","updated_at":"2026-09-16T00:00:00Z"}]}' "\${DRIFT_HEALTH_CONCLUSION:-success}")
    ;;
  https://api.telegram.org/*)
    body='{"ok":true}'
    ;;
esac

if [ -n "$out" ] && [ "$out" != "/dev/null" ]; then
  printf '%s' "$body" > "$out"
fi
if [ -n "$hdrs" ]; then
  printf '%s\\n' "$headers" > "$hdrs"
fi
if [ -n "$want" ]; then
  printf '%s' "$status"
elif [ -z "$out" ] || [ "$out" = "/dev/stdout" ]; then
  printf '%s' "$body"
fi
`;

function git(cwd, args, extraEnv = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "drift-test",
      GIT_AUTHOR_EMAIL: "drift-test@example.com",
      GIT_COMMITTER_NAME: "drift-test",
      GIT_COMMITTER_EMAIL: "drift-test@example.com",
      ...extraEnv,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function runDriftCheck({
  docsOnly = false,
  freshTip = false,
  liveIsTip = false,
  healthGate = "success",
  healthConclusion = "success",
  ignoredTipAfterApp = false,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "prod-health-drift-"));
  const bin = join(directory, "bin");
  const repo = join(directory, "repo");
  const runnerTemp = join(directory, "runner-temp");
  await mkdir(bin);
  await mkdir(repo);
  await mkdir(runnerTemp);
  await writeFile(join(bin, "curl"), DRIFT_CURL_STUB);
  await writeFile(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  await chmod(join(bin, "curl"), 0o755);
  await chmod(join(bin, "sleep"), 0o755);

  const staleDate = "2026-09-15T05:29:20 +0000";
  const dateEnv = freshTip
    ? {}
    : { GIT_AUTHOR_DATE: staleDate, GIT_COMMITTER_DATE: staleDate };

  git(repo, ["init"]);
  await writeFile(join(repo, "app.js"), "v1\n");
  git(repo, ["add", "app.js"]);
  git(repo, ["commit", "-m", "old"], dateEnv);
  const liveSha = git(repo, ["rev-parse", "HEAD"]);

  if (docsOnly) {
    await writeFile(join(repo, "README.md"), "docs only\n");
    git(repo, ["add", "README.md"]);
  } else {
    await writeFile(join(repo, "app.js"), "v2\n");
    git(repo, ["add", "app.js"]);
  }
  git(repo, ["commit", "-m", "tip"], dateEnv);
  let tipSha = git(repo, ["rev-parse", "HEAD"]);
  const appSha = tipSha;
  if (ignoredTipAfterApp) {
    await writeFile(join(repo, "README.md"), "docs after app\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "docs tip"], dateEnv);
    tipSha = git(repo, ["rev-parse", "HEAD"]);
  }

  try {
    const result = spawnSync("bash", ["-c", await driftScript()], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        VERCEL_TOKEN: "stub-vercel-token",
        TG_TOKEN: "stub-tg-token",
        TG_CHAT: "stub-tg-chat",
        PROJECT_ID: "prj_stub",
        TEAM_ID: "team_stub",
        RUNNER_TEMP: runnerTemp,
        GITHUB_TOKEN: "stub-github-token",
        GITHUB_REPOSITORY: "hypertask-ai/hypertask",
        DRIFT_TIP_SHA: ignoredTipAfterApp ? appSha : tipSha,
        DRIFT_LIVE_SHA: liveIsTip ? tipSha : liveSha,
        DRIFT_HEALTH_GATE: healthGate,
        DRIFT_HEALTH_CONCLUSION: healthConclusion,
      },
    });
    const promoted = await readFile(join(runnerTemp, "promoted"), "utf8").catch(
      () => null,
    );
    return { result, promoted, tipSha, liveSha, appSha };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// HTPR-6511: Vercel already had a READY deploy for 95f3471, and the newest
// READY SHA matched the production tip, but /api/version still served 058a6cf.
// Drift trusted the newest READY row and stayed green for hours.
test("drift promotes when /api/version lags a READY production tip", async () => {
  const { result, promoted } = await runDriftCheck();

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Promoted deploy-tip|production now serves the tip/i);
  assert.ok(promoted, "drift must promote the tip deploy when /api/version is stale");
  assert.match(promoted, /\/promote\/deploy-tip/);
});

test("drift does not promote when /api/version already matches the tip", async () => {
  const { result, promoted } = await runDriftCheck({ liveIsTip: true });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Production is on the production tip/);
  assert.equal(promoted, null);
});

test("drift does not promote a docs-only gap", async () => {
  const { result, promoted } = await runDriftCheck({ docsOnly: true });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /non-building commits/);
  assert.equal(promoted, null);
});

test("drift does not promote a SHA whose prod-health run failed", async () => {
  const { result, promoted } = await runDriftCheck({
    healthGate: "failure",
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no green prod-health gate|No READY deploy with a green health gate/);
  assert.equal(promoted, null);
});

test("drift does not promote a SHA whose later prod-health job failed", async () => {
  const { result, promoted } = await runDriftCheck({
    healthGate: "success",
    healthConclusion: "failure",
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /latest prod-health run concluded|No READY deploy with a green health gate/);
  assert.equal(promoted, null);
});

test("drift does not promote a SHA whose latest prod-health run timed out", async () => {
  const { result, promoted } = await runDriftCheck({
    healthGate: "success",
    healthConclusion: "timed_out",
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /latest prod-health run concluded|No READY deploy with a green health gate/);
  assert.equal(promoted, null);
});

test("drift promotes the READY app ancestor when the tip is a docs commit", async () => {
  const { result, promoted } = await runDriftCheck({ ignoredTipAfterApp: true });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Promoted deploy-tip|production now serves the tip/i);
  assert.ok(promoted, "drift must promote the app deploy in front of an ignored tip");
  assert.match(promoted, /\/promote\/deploy-tip/);
});

function makeCommitChild(parent, { appChange = false, message = "htpr-6511-child" } = {}) {
  let tree;
  if (appChange) {
    const tmpIndex = join(tmpdir(), `htpr-6511-idx-${process.pid}-${Date.now()}`);
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    const read = spawnSync("git", ["read-tree", parent], { encoding: "utf8", env });
    assert.equal(read.status, 0, read.stderr);
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], {
      input: "htpr-6511-app-change\n",
      encoding: "utf8",
    });
    assert.equal(blob.status, 0, blob.stderr);
    const upd = spawnSync(
      "git",
      [
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${blob.stdout.trim()},htpr-6511-app-file.txt`,
      ],
      { encoding: "utf8", env },
    );
    assert.equal(upd.status, 0, upd.stderr);
    const written = spawnSync("git", ["write-tree"], { encoding: "utf8", env });
    assert.equal(written.status, 0, written.stderr);
    tree = written.stdout.trim();
    rm(tmpIndex, { force: true }).catch(() => {});
  } else {
    const parsed = spawnSync("git", ["rev-parse", `${parent}^{tree}`], {
      encoding: "utf8",
    });
    assert.equal(parsed.status, 0, parsed.stderr);
    tree = parsed.stdout.trim();
  }
  const child = spawnSync(
    "git",
    ["commit-tree", tree, "-p", parent, "-m", message],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "drift-test",
        GIT_AUTHOR_EMAIL: "drift-test@example.com",
        GIT_COMMITTER_NAME: "drift-test",
        GIT_COMMITTER_EMAIL: "drift-test@example.com",
      },
    },
  );
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim();
}

test("health skips alias repair when origin/production already moved on", async () => {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(head.status, 0, head.stderr);
  const newer = makeCommitChild(head.stdout.trim(), {
    appChange: true,
    message: "htpr-6511-app-head",
  });
  const { result, promoted } = await runHealthCheck("ok ok healthy", {
    SHA: head.stdout.trim(),
    HC_VERSION_SHA: "a".repeat(40),
    PROD_HEAD_OVERRIDE: newer,
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /origin\/production already moved|Superseded/);
  assert.equal(promoted, null);
});

test("health still repairs when origin/production only moved by ignored files", async () => {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(head.status, 0, head.stderr);
  const docs = makeCommitChild(head.stdout.trim(), {
    message: "htpr-6511-docs-only",
  });
  const { result, promoted } = await runHealthCheck("ok ok healthy", {
    SHA: head.stdout.trim(),
    HC_VERSION_SHA: "a".repeat(40),
    PROD_HEAD_OVERRIDE: docs,
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ignored files only|Alias repair landed|Production healthy/);
  assert.ok(promoted, "docs-only tip must not block alias repair of the app SHA");
  assert.match(promoted, /\/promote\/deploy-current/);
});

test("health skips alias repair when a later version read is a newer descendant", async () => {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(head.status, 0, head.stderr);
  const child = makeCommitChild(head.stdout.trim(), {
    appChange: true,
    message: "htpr-6511-app-descendant",
  });
  const { result, promoted } = await runHealthCheck("ok ok healthy", {
    SHA: head.stdout.trim(),
    HC_VERSION_SHA: "a".repeat(40),
    HC_VERSION_RECHECK_SHA: child,
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /already serves newer build|Superseded/);
  assert.equal(promoted, null);
});

test("core-actions rollback invalidates the health gate", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const start = workflow.indexOf("\n  core-actions:");
  const next = workflow.indexOf("\n  provision-core-actions:", start);
  assert.ok(start !== -1 && next !== -1);
  const block = workflow.slice(start, next);
  assert.match(block, /statuses: write/);
  assert.match(block, /prod-health-gate/);
  assert.match(block, /Rolled back after failed core-actions/);
  assert.match(block, /SHOULD_ROLLBACK/);
  const rollbackAt = block.indexOf("SHOULD_ROLLBACK");
  const invalidateAt = block.indexOf("invalidate prod-health-gate");
  const emergencyAt = block.indexOf("emergency-rollback.mjs");
  assert.ok(rollbackAt !== -1 && invalidateAt !== -1 && emergencyAt !== -1);
  assert.ok(invalidateAt < emergencyAt, "gate invalidation is attempted before rollback");
  assert.match(block, /Rolled back \$GITHUB_SHA but failed to invalidate/);
});
