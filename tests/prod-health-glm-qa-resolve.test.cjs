// HYCI-36 — behavioral tests for the glm-qa job's merged-pull-request read.
// The step's `run: |` block is extracted from the workflow YAML, de-indented and
// executed as a bash script with stub `curl`/`sleep` binaries on the PATH, the
// same way tests/prod-health-workflow.test.cjs exercises the health job.
//
// The read answered 403 (rate limited) on 87 of the last 500 production runs and
// reddened every one of those pushes after the merge and deploy had succeeded.
// It must retry, then fail open and skip the brief. The genuine ambiguity — more
// than one merged PR containing the commit — must still fail loudly.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

async function resolveScript() {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const jobStart = workflow.indexOf("\n  glm-qa:\n");
  assert.notEqual(jobStart, -1, "glm-qa job not found");
  const jobEnd = workflow.indexOf("\n  drift:", jobStart);
  assert.notEqual(jobEnd, -1, "glm-qa job end not found");
  const job = workflow.slice(jobStart, jobEnd);
  const stepStart = job.indexOf("- name: Resolve the merged pull request");
  assert.notEqual(stepStart, -1, "resolve step not found");
  const marker = "        run: |\n";
  const start = job.indexOf(marker, stepStart);
  assert.notEqual(start, -1, "resolve step has no run block");
  const lines = job.slice(start + marker.length).split("\n");
  const block = [];
  for (const line of lines) {
    if (line === "") {
      block.push("");
      continue;
    }
    const indent = (line.match(/^ */) || [""])[0].length;
    if (indent <= 8) break; // next step key
    block.push(line.slice(10));
  }
  return block.join("\n");
}

// Serves one status per read from HC_PR_SEQUENCE and answers with HC_PR_BODY.
const CURL_STUB = `#!/usr/bin/env bash
set -u
out=""
want=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -s|-S|-sS) shift ;;
    -o) out="$2"; shift 2 ;;
    -w) want="$2"; shift 2 ;;
    -H) shift 2 ;;
    *) case "$1" in https://*) url="$1" ;; esac; shift ;;
  esac
done
count_file="$RUNNER_TEMP/pr-count"
idx=0
if [ -f "$count_file" ]; then idx=$(cat "$count_file"); fi
idx=$((idx + 1))
printf '%s' "$idx" > "$count_file"
status=$(printf '%s' "\${HC_PR_SEQUENCE:-200}" | awk -v n="$idx" '{print $n}')
if [ -z "$status" ]; then status=$(printf '%s' "\${HC_PR_SEQUENCE:-200}" | awk '{print $NF}'); fi
body="\${HC_PR_BODY:-[]}"
if [ "$status" = "200" ]; then
  if [ -n "$out" ]; then printf '%s' "$body" > "$out"; fi
else
  # A failed request writes no body, like curl -o with a failed transfer.
  if [ -n "$out" ]; then : > "$out"; fi
fi
if [ -n "$want" ]; then printf '%s' "$status"; fi
exit 0
`;

async function runResolve(extraEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "prod-health-glm-qa-"));
  const bin = join(directory, "bin");
  const runnerTemp = join(directory, "runner-temp");
  await mkdir(bin);
  await mkdir(runnerTemp);
  await writeFile(join(bin, "curl"), CURL_STUB);
  await writeFile(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  await chmod(join(bin, "curl"), 0o755);
  await chmod(join(bin, "sleep"), 0o755);

  try {
    const result = spawnSync("bash", ["-e", "-c", await resolveScript()], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_TOKEN: "stub-token",
        SHA: "c".repeat(40),
        REPO: "hypertask-ai/hypertask",
        RUNNER_TEMP: runnerTemp,
        GITHUB_OUTPUT: join(runnerTemp, "github-output"),
        ...extraEnv,
      },
    });
    const outputs = await readFile(join(runnerTemp, "github-output"), "utf8").catch(() => "");
    return { result, outputs };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const mergedPr = (number, title = `PR ${number}`) =>
  JSON.stringify([{ number, title, merged_at: "2026-10-31T08:00:00Z" }]);

test("a readable merged pull request sets the brief's ticket", async () => {
  const { result, outputs } = await runResolve({ HC_PR_BODY: mergedPr(2633, "HYCI-36 fix") });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(outputs, /number=2633/);
  assert.match(outputs, /title=HYCI-36 fix/);
  assert.doesNotMatch(outputs, /skipped=true/);
});

// The retry: a rate-limited read must not cost the brief on its own.
test("a read that answers 403 twice and then 200 still resolves the ticket", async () => {
  const { result, outputs } = await runResolve({
    HC_PR_SEQUENCE: "403 403 200",
    HC_PR_BODY: mergedPr(2633, "HYCI-36 fix"),
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /attempt 1: merged-pull-request read answered 403/);
  assert.match(result.stdout, /attempt 2: merged-pull-request read answered 403/);
  assert.match(outputs, /number=2633/);
});

// The fail open: exploratory QA failing to find its ticket never reds a push
// whose merge and deploy already succeeded.
test("a read that keeps failing skips the brief with a warning instead of failing the job", async () => {
  const { result, outputs } = await runResolve({ HC_PR_SEQUENCE: "403 403 403" });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /::warning::Could not read the merged pull request/);
  assert.match(result.stdout, /HTTP 403 after 3 attempts/);
  assert.doesNotMatch(result.stdout, /::error::/);
  assert.match(outputs, /skipped=true/);
});

test("a connection failure is retried and then skipped, not failed", async () => {
  const { result, outputs } = await runResolve({ HC_PR_SEQUENCE: "000 500 000" });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /::warning::Could not read the merged pull request/);
  assert.match(outputs, /skipped=true/);
});

test("a commit with no merged pull request is an ordinary skip", async () => {
  const { result, outputs } = await runResolve({
    HC_PR_BODY: JSON.stringify([{ number: 1, title: "open head PR", merged_at: null }]),
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No merged pull request associated with/);
  assert.match(outputs, /skipped=true/);
});

// The ambiguity is not a flake: guessing the deploy ticket would brief the wrong
// change, so it must stay red.
test("two merged pull requests containing the commit still fail the job", async () => {
  const { result, outputs } = await runResolve({
    HC_PR_BODY: JSON.stringify([
      { number: 1, title: "a", merged_at: "2026-10-31T08:00:00Z" },
      { number: 2, title: "b", merged_at: "2026-10-31T08:01:00Z" },
    ]),
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /2 merged pull requests contain/);
  assert.doesNotMatch(outputs, /skipped=true/);
});
