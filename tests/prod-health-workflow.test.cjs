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
    body=\$(printf '{"buildId":"%s"}' "\$SHA")
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

async function runHealthCheck(hcSequence) {
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
        HC_SEQUENCE: hcSequence,
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
