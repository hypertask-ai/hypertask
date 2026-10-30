const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

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
    if (indent <= 8) break;
    block.push(line.slice(10));
  }
  return block
    .join("\n")
    .replaceAll("${{ github.repository }}", "test/repo");
}

test("only the guarded rollback job has deployment mutation authority", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const forbidden = /emergency-rollback|\/promote\/|ROLLBACK_GITHUB_TOKEN|MERGE_FREEZE|git (?:push|revert)/;
  const monitors = workflow.slice(0, workflow.indexOf("\n  rollback:"));
  assert.doesNotMatch(monitors, forbidden);
  assert.throws(() => assert.doesNotMatch(
    `${monitors}\nrun: node .github/scripts/emergency-rollback.mjs`,
    forbidden,
  ), { code: "ERR_ASSERTION" });
  assert.match(workflow, /name: Prod Health Check \+ Auto-Rollback/);
  assert.match(workflow, /needs: \[health, smoke, core-actions\]/);
  assert.match(workflow.slice(workflow.indexOf("\n  rollback:")), /github\.event_name == 'push'/);
});

test("health and drift jobs cannot overlap", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  assert.match(
    workflow,
    /^concurrency:\n(?:  #[^\n]*\n)*  group: prod-health\n  cancel-in-progress: false\n/m,
  );
  const driftStart = workflow.indexOf("\n  drift:");
  const nextJob = workflow.indexOf("\n  core-actions:", driftStart);
  assert.ok(driftStart !== -1 && nextJob !== -1);
  assert.doesNotMatch(workflow.slice(driftStart, nextJob), /concurrency:/);
});

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
exit_code=0

case "$url" in
  https://api.vercel.com/v6/deployments*)
    exit_code=\${HC_DEPLOYMENTS_EXIT_CODE:-0}
    if [ -n "\${HC_DEPLOYMENTS_JSON:-}" ]; then
      body=\$(printf '%s' "\$HC_DEPLOYMENTS_JSON" | sed "s/__SHA__/\$SHA/g")
    else
      body=\$(printf '{"deployments":[{"uid":"deploy-current","state":"READY","meta":{"githubCommitSha":"%s"}},{"uid":"deploy-prev","state":"READY","meta":{"githubCommitSha":"other"}}]}' "\$SHA")
    fi
    ;;
  https://api.vercel.com/v10/projects/*/promote/*)
    printf '%s' "\$url" > "\$RUNNER_TEMP/promoted"
    body='{"ok":true}'
    ;;
  https://api.telegram.org/*)
    body='{"ok":true}'
    ;;
  https://status.pusher.com/api/v2/status.json)
    body="\${HC_PUSHER_STATUS_JSON:-}"
    ;;
  https://status.pusher.com/api/v2/components.json)
    body="\${HC_PUSHER_COMPONENTS_JSON:-}"
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
      connfail) status="000"; out=""; hdrs=""; exit_code=7 ;;
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
exit "\$exit_code"
`;

async function runHealthCheck(hcSequence, extraEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "prod-health-workflow-"));
  const bin = join(directory, "bin");
  const runnerTemp = join(directory, "runner-temp");
  await mkdir(bin);
  await mkdir(runnerTemp);

  const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" });
  assert.equal(realGit.status, 0, realGit.stderr);
  await writeFile(join(bin, "curl"), CURL_STUB);
  await writeFile(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  await writeFile(join(bin, "git"), '#!/usr/bin/env bash\nif [ "$1" = "fetch" ]; then exit 0; fi\nexec "$HC_REAL_GIT" "$@"\n');
  await chmod(join(bin, "curl"), 0o755);
  await chmod(join(bin, "sleep"), 0o755);
  await chmod(join(bin, "git"), 0o755);

  try {
    const result = spawnSync("bash", ["-e", "-c", await workflowScript()], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        VERCEL_TOKEN: "stub-vercel-token",
        MCP_TOKEN: "stub-mcp-token",
        ROLLBACK_GITHUB_TOKEN: "stub-rollback-token",
        TG_TOKEN: "stub-tg-token",
        TG_CHAT: "stub-tg-chat",
        SHA: "c".repeat(40),
        PROJECT_ID: "prj_stub",
        TEAM_ID: "team_stub",
        RUNNER_TEMP: runnerTemp,
        GITHUB_OUTPUT: join(runnerTemp, "github-output"),
        HC_SEQUENCE: hcSequence,
        HC_REAL_GIT: realGit.stdout.trim(),
        ...extraEnv,
      },
    });
    const promoted = await readFile(join(runnerTemp, "promoted"), "utf8").catch(
      () => null,
    );
    const outputs = await readFile(join(runnerTemp, "github-output"), "utf8").catch(() => "");
    return { result, promoted, outputs };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("an unchallenged final broken response requests guarded rollback after an earlier challenge", async () => {
  const { result, promoted } = await runHealthCheck(
    "challenge challenge challenge ok ok broken ok ok broken",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /health checks failed; guarded rollback requested/);
  assert.doesNotMatch(result.stdout, /Bot-challenged responses only/);
  assert.equal(promoted, null, "a failed health check must not promote");
});

test("a genuinely challenged-only run never rolls back", async () => {
  const { result, promoted } = await runHealthCheck(
    "challenge challenge challenge challenge challenge challenge challenge challenge challenge",
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Bot-challenged responses only; skipping rollback/);
  assert.equal(promoted, null, "a challenged-only run must not promote");
});

test("a read-passing inconclusive probe fails the job but never rolls back", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok inconclusive ok ok inconclusive ok ok inconclusive",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /Task-write probe inconclusive/);
  assert.equal(promoted, null, "an inconclusive probe must not promote");
});

test("an unprovisioned probe fixture fails the job without rolling back", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok misconfigured ok ok misconfigured ok ok misconfigured",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /write gate is inactive/);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.equal(promoted, null, "a missing fixture must not promote");
});

test("a missing fixture does not suppress the alert for a real final-attempt failure", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok misconfigured ok ok misconfigured ok 500 broken",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /health checks failed; guarded rollback requested/);
  assert.equal(promoted, null, "a standing definitive failure must not promote");
});

test("an earlier challenged probe does not let a final inconclusive probe pass", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok challenge ok ok inconclusive ok ok inconclusive",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /Task-write probe inconclusive/);
  assert.equal(promoted, null, "an inconclusive probe must not promote");
});

test("a fully healthy run exits clean and never rolls back", async () => {
  const { result, promoted } = await runHealthCheck("ok ok healthy");

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Production healthy/);
  assert.equal(promoted, null, "a healthy run must not promote");
});

test("two deployments for one commit pick the READY one without a broken pipe", async () => {
  const failed = (n) => `{"uid":"deploy-oom-${n}","state":"ERROR","meta":{"githubCommitSha":"__SHA__"},"pad":"${"x".repeat(40000)}"}`;
  const { result, promoted } = await runHealthCheck("ok ok healthy", {
    HC_DEPLOYMENTS_JSON: `{"deployments":[${failed(1)},${failed(2)},{"uid":"deploy-retry","state":"READY","meta":{"githubCommitSha":"__SHA__"}}]}`,
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /Broken pipe/);
  assert.match(result.stdout, /deployment state: READY/);
  assert.match(result.stdout, /Production healthy/);
  assert.equal(promoted, null);
});

test("a commit with no deployment exits clean as an ignored build", async () => {
  const { result, promoted } = await runHealthCheck("ok ok healthy", {
    HC_DEPLOYMENTS_JSON: '{"deployments":[{"uid":"deploy-other","state":"READY","meta":{"githubCommitSha":"other"}}]}',
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[12\] deployment state: NOTFOUND/);
  assert.doesNotMatch(result.stdout, /\[13\] deployment state/);
  assert.match(result.stdout, /No production deployment for/);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.equal(promoted, null);
});

for (const [name, extraEnv] of [
  ["a non-JSON deployment response", { HC_DEPLOYMENTS_JSON: "<html>unavailable</html>" }],
  ["an empty deployment response", { HC_DEPLOYMENTS_JSON: " " }],
  ["a deployment response without a deployments list", { HC_DEPLOYMENTS_JSON: '{"error":{"code":"forbidden"}}' }],
  ["a failed deployment request", { HC_DEPLOYMENTS_EXIT_CODE: "7" }],
]) {
  test(`${name} reaches the deployment-wait alert without rollback`, async () => {
    const { result, promoted, outputs } = await runHealthCheck("ok ok healthy", extraEnv);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /after 60 checks; not verified/);
    assert.doesNotMatch(result.stdout, /Production healthy/);
    assert.equal(outputs.includes("rollback=true"), false);
    assert.equal(promoted, null);
  });
}

test("a stale healthy probe body from an earlier attempt is not healthy", async () => {
  const { result, promoted } = await runHealthCheck(
    "challenge challenge healthy ok ok connfail ok ok connfail",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /health checks failed; guarded rollback requested/);
  assert.equal(promoted, null, "a failed health check must not promote");
});

test("a non-200 probe response with a healthy-looking body is not healthy", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok healthy500 ok ok healthy500 ok ok healthy500",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /health checks failed; guarded rollback requested/);
  assert.equal(promoted, null, "a failed health check must not promote");
});

test("a challenged homepage does not mask an unchallenged broken probe in the same attempt", async () => {
  const { result, promoted } = await runHealthCheck(
    "challenge ok broken challenge ok broken challenge ok broken",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /health checks failed; guarded rollback requested/);
  assert.equal(promoted, null, "a failed health check must not promote");
});

test("a challenged probe does not mask an unchallenged non-200 API response in the same attempt", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok broken challenge ok broken challenge ok broken challenge",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /health checks failed; guarded rollback requested/);
  assert.equal(promoted, null, "a failed health check must not promote");
});

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

test("a persistent unchallenged broken probe requests guarded rollback", async () => {
  const { result, promoted } = await runHealthCheck(
    "ok ok broken ok ok broken ok ok broken",
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.match(result.stdout, /health checks failed; guarded rollback requested/);
  assert.equal(promoted, null, "a failed health check must not promote");
});

test("a READY deploy that missed the alias fails without promotion", async () => {
  const { result, promoted } = await runHealthCheck("ok ok healthy", {
    HC_VERSION_SHA: "a".repeat(40),
    ROLLBACK_GITHUB_TOKEN: "stub-rollback-token",
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Alert only; investigate Vercel aliasing/);
  assert.doesNotMatch(result.stdout, /Production healthy/);
  assert.equal(promoted, null, "alias drift must not promote");
});

test("health passes when the alias catches up on the final read without promotion", async () => {
  const { result, promoted } = await runHealthCheck("ok ok healthy", {
    HC_VERSION_SHA: "a".repeat(40),
    HC_VERSION_RECHECK_SHA: "c".repeat(40),
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Production healthy/);
  assert.equal(promoted, null);
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
    if [ -n "\${DRIFT_VERSION_BODY:-}" ]; then
      body="$DRIFT_VERSION_BODY"
    elif [ -f "$RUNNER_TEMP/promoted" ]; then
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
    if [ -n "\${DRIFT_TARGET_BODY:-}" ]; then body="$DRIFT_TARGET_BODY"; fi
    if [ "\${DRIFT_TARGET_CONNFAIL:-}" = "1" ]; then exit 7; fi
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
  const result = spawnSync("git", [
    "-c",
    "user.name=drift-test",
    "-c",
    "user.email=drift-test@example.com",
    ...args,
  ], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "drift-test",
      GIT_AUTHOR_EMAIL: "drift-test@example.com",
      GIT_COMMITTER_NAME: "drift-test",
      GIT_COMMITTER_EMAIL: "drift-test@example.com",
      ...extraEnv,
      GIT_AUTHOR_NAME: extraEnv.GIT_AUTHOR_NAME || "drift-test",
      GIT_AUTHOR_EMAIL: extraEnv.GIT_AUTHOR_EMAIL || "drift-test@example.com",
      GIT_COMMITTER_NAME: extraEnv.GIT_COMMITTER_NAME || "drift-test",
      GIT_COMMITTER_EMAIL: extraEnv.GIT_COMMITTER_EMAIL || "drift-test@example.com",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("temp-repo commits work when the runner has no git author identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prod-health-identity-"));
  const noIdentity = {
    GIT_AUTHOR_NAME: "",
    GIT_AUTHOR_EMAIL: "",
    GIT_COMMITTER_NAME: "",
    GIT_COMMITTER_EMAIL: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    HOME: directory,
  };
  try {
    git(directory, ["init"], noIdentity);
    await writeFile(join(directory, "app.js"), "v1\n");
    git(directory, ["add", "app.js"], noIdentity);
    git(directory, ["commit", "-m", "identity"], noIdentity);
    assert.match(git(directory, ["rev-parse", "HEAD"], noIdentity), /^[0-9a-f]{40}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function runDriftCheck({
  docsOnly = false,
  ignoredFile = "README.md",
  freshTip = false,
  liveIsTip = false,
  healthGate = "success",
  healthConclusion = "success",
  ignoredTipAfterApp = false,
  extraEnv = {},
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
  await mkdir(join(repo, "scripts"));
  await writeFile(join(repo, "scripts/vercel-ignore-build.cjs"),
    await readFile("scripts/vercel-ignore-build.cjs", "utf8"));
  await writeFile(join(repo, "app.js"), "v1\n");
  git(repo, ["add", "app.js"]);
  git(repo, ["commit", "-m", "old"], dateEnv);
  const liveSha = git(repo, ["rev-parse", "HEAD"]);

  if (docsOnly) {
    await mkdir(join(repo, ignoredFile, ".."), { recursive: true });
    await writeFile(join(repo, ignoredFile), "docs only\n");
    git(repo, ["add", ignoredFile]);
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
    const result = spawnSync("bash", ["-e", "-c", await driftScript()], {
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
        ...extraEnv,
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

test("drift alerts without promotion when /api/version lags a READY production tip", async () => {
  const { result, promoted } = await runDriftCheck();

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /BEHIND the production tip.*Alert only/);
  assert.equal(promoted, null, "drift must not promote even a green READY deploy");
});

test("drift still reports an older target when /api/version is non-JSON", async () => {
  const { result, promoted } = await runDriftCheck({
    extraEnv: { DRIFT_VERSION_BODY: "<html>challenge</html>" },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /falling back to Vercel production target/);
  assert.match(result.stdout, /BEHIND the production tip.*Alert only/);
  assert.equal(promoted, null);
});

for (const [name, extraEnv] of [
  ["non-JSON", { DRIFT_TARGET_BODY: "<html>unavailable</html>" }],
  ["unreachable", { DRIFT_TARGET_CONNFAIL: "1" }],
]) {
  test(`drift skips an unverifiable version and ${name} target without promotion`, async () => {
    const { result, promoted } = await runDriftCheck({
      extraEnv: { DRIFT_VERSION_BODY: "<html>challenge</html>", ...extraEnv },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /No live production SHA.*nothing to compare/);
    assert.equal(promoted, null);
  });
}

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
  assert.match(result.stdout, /BEHIND the production tip.*Alert only/);
  assert.equal(promoted, null);
});

test("drift does not promote a SHA whose later prod-health job failed", async () => {
  const { result, promoted } = await runDriftCheck({
    healthGate: "success",
    healthConclusion: "failure",
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /BEHIND the production tip.*Alert only/);
  assert.equal(promoted, null);
});

test("drift does not promote a SHA whose latest prod-health run timed out", async () => {
  const { result, promoted } = await runDriftCheck({
    healthGate: "success",
    healthConclusion: "timed_out",
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /BEHIND the production tip.*Alert only/);
  assert.equal(promoted, null);
});

test("drift alerts without promotion when an app ancestor precedes a docs tip", async () => {
  const { result, promoted } = await runDriftCheck({ ignoredTipAfterApp: true });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /BEHIND the production tip.*Alert only/);
  assert.equal(promoted, null, "an ignored tip must not authorize promotion");
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
    ["-c", "user.name=drift-test", "-c", "user.email=drift-test@example.com", "commit-tree", tree, "-p", parent, "-m", message],
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

test("health still reports drift when origin/production only moved by ignored files", async () => {
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

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ignored files only/);
  assert.match(result.stdout, /Alert only; investigate Vercel aliasing/);
  assert.equal(promoted, null, "docs-only tip must not authorize alias repair");
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

test("a failed post-deploy core-actions probe invalidates the health gate without rollback", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const start = workflow.indexOf("\n  core-actions:");
  const next = workflow.indexOf("\n  provision-core-actions:", start);
  assert.ok(start !== -1 && next !== -1);
  const block = workflow.slice(start, next);
  assert.match(block, /statuses: write/);
  assert.match(block, /prod-health-gate/);
  assert.match(block, /Failed core-actions/);
  assert.match(block, /rollback-decision/);
  assert.match(block, /could not invalidate prod-health-gate/);
  assert.match(block, /CORE_SMOKE_ROLLBACK: .*guarded rollback requested/);
  assert.doesNotMatch(block, /emergency-rollback|\/promote\//);
});


test("only the existing definitive final-attempt health alarm requests rollback", async () => {
  for (const [sequence, expected] of [
    ["ok ok broken ok ok broken ok ok broken", true],
    ["challenge challenge challenge ok ok broken ok ok broken", true],
    ["ok ok broken ok ok broken ok ok healthy", false],
    ["ok ok broken challenge challenge challenge challenge challenge challenge", false],
    ["ok ok inconclusive ok ok inconclusive ok ok inconclusive", false],
    ["ok ok misconfigured ok ok misconfigured ok ok misconfigured", false],
    ["challenge challenge challenge challenge challenge challenge challenge challenge challenge", false],
  ]) {
    const { outputs } = await runHealthCheck(sequence);
    assert.equal(outputs.includes("rollback=true"), expected, sequence);
  }
});

test("every failed inbox step is reported and leaves production health red", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/prod-health.yml", "utf8"));
  const core = workflow.jobs["core-actions"];
  assert.match(core.if, /github.event_name == 'push'.*needs.health.outputs.live == 'true'/);
  const probe = core.steps.find((step) => step.id === "probe");
  const report = core.steps.find((step) => step.name === "Report a failed or unrunnable check");
  const final = core.steps.find((step) => step.name === "Keep failed monitoring visible");
  assert.equal(probe.env.HYPERTASK_MCP_TOKEN, "${{ secrets.HYPERTASK_HEALTH_USER_TOKEN }}");
  assert.equal(probe.run, "node .github/scripts/core-actions-smoke.mjs run");
  assert.equal(probe["continue-on-error"], true);
  assert.equal(report.run, "node .github/scripts/core-actions-smoke.mjs report");
  assert.equal(report["continue-on-error"], undefined);
  for (const step of [report, final]) {
    assert.equal(step.if, "${{ !cancelled() && steps.probe.outcome == 'failure' }}");
    assert.doesNotMatch(step.run, /emergency-rollback|git (?:push|revert)|\/promote\//);
  }
  const result = spawnSync("bash", ["-e", "-c", final.run], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /::error::.*inbox routines.*did not pass/);
  const script = await readFile(".github/scripts/core-actions-smoke.mjs", "utf8");
  assert.match(script, /if \(!result.ok\) process.exitCode = 1/);
  assert.match(script, /!String\(result\?\.action\).startsWith\("inbox "\)/);
  const green = spawnSync("bash", ["-c", "exit 0"], { encoding: "utf8" });
  assert.notEqual(green.status, result.status);
});

for (const [name, statusBody, componentsBody, exitStatus, message] of [
  ["non-JSON status", "<html>unavailable</html>", "", 0, /Could not read Pusher status page; skipping/],
  ["operational status", '{"status":{"indicator":"none","description":"Operational"}}', "", 0, /Pusher is operational/],
  ["major status with non-JSON components", '{"status":{"indicator":"major","description":"Outage"}}', "<html>unavailable</html>", 1, /::error::Pusher status is major: Outage \(no Channels component reported as degraded\)/],
  ["minor status with non-JSON components", '{"status":{"indicator":"minor","description":"Degraded"}}', "<html>unavailable</html>", 0, /::warning::Pusher status is minor/],
  ["major status with affected Channels", '{"status":{"indicator":"major","description":"Outage"}}', '{"components":[{"name":"Channels","status":"major_outage"}]}', 1, /::error::Pusher status is major: Outage \(Channels: major_outage\)/],
]) {
  test(`Pusher handles ${name} under errexit`, async () => {
    const yaml = require("js-yaml");
    const workflow = yaml.load(await readFile(".github/workflows/prod-health.yml", "utf8"));
    const script = workflow.jobs["pusher-status"].steps[0].run;
    const directory = await mkdtemp(join(tmpdir(), "prod-health-pusher-"));
    const bin = join(directory, "bin");
    try {
      await mkdir(bin);
      await writeFile(join(bin, "curl"), CURL_STUB);
      await chmod(join(bin, "curl"), 0o755);
      const result = spawnSync("bash", ["-e", "-c", script], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          HC_PUSHER_STATUS_JSON: statusBody,
          HC_PUSHER_COMPONENTS_JSON: componentsBody,
        },
      });
      assert.equal(result.status, exitStatus, result.stdout + result.stderr);
      assert.match(result.stdout, message);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const ignoredFile of ["tests/new.test.cjs", "e2e/smoke/new.spec.ts", "skills/a/SKILL.md"]) {
  test(`drift accepts a skipped deployment containing only ${ignoredFile}`, async () => {
    const { result, promoted } = await runDriftCheck({ docsOnly: true, ignoredFile });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /behind only by non-building commits/);
    assert.equal(promoted, null);
  });
}
