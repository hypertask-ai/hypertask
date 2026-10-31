const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const CURL = `#!/bin/sh
out=""; url=""; prev=""
for a in "$@"; do
  [ "$prev" = "-o" ] && out="$a"
  case "$a" in http*) url="$a" ;; esac
  prev="$a"
done
case "$url" in
  *app.hypertask.ai/api/version*)
    [ -n "$out" ] && printf '%s' "$LIVE_JSON" > "$out"
    printf '200' ;;
  *api.vercel.com*deployments*)
    printf '%s' "$DEPLOY_JSON" ;;
  *)
    printf '%s' '{}' ;;
esac
`;

const NODE = `#!/bin/sh
printf '%s\\n' "$*" >> "$NODE_LOG"
case "$*" in
  *vercel-ignore-build*) exit 1 ;;
  *) exit 0 ;;
esac
`;

function workflowRun() {
  const workflow = require("node:fs").readFileSync(".github/workflows/prod-health.yml", "utf8");
  const start = workflow.indexOf("      - name: Compare the live production deployment against the production tip");
  const runStart = workflow.indexOf("        run: |\n", start) + "        run: |\n".length;
  const runEnd = workflow.indexOf("\n  # ── Pusher status", runStart);
  assert.ok(start !== -1 && runStart > start && runEnd > runStart, "drift step not found");
  return workflow.slice(runStart, runEnd).split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
}

function repository() {
  const directory = require("node:fs").mkdtempSync(join(tmpdir(), "drift-repo-"));
  const git = (...args) => spawnSync("git", args, {
    cwd: directory, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
  });
  git("init", "-q");
  git("config", "user.email", "qa@example.com");
  git("config", "user.name", "QA");
  require("node:fs").writeFileSync(join(directory, "app"), "one\n");
  git("add", "app");
  git("commit", "-qm", "live");
  require("node:fs").writeFileSync(join(directory, "app"), "two\n");
  git("commit", "-qam", "tip");
  const live = spawnSync("git", ["rev-parse", "HEAD~1"], { cwd: directory, encoding: "utf8" }).stdout.trim();
  const tip = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).stdout.trim();
  return { directory, live, tip };
}

async function run({ state, deployJson }) {
  const { directory, live, tip } = repository();
  try {
    const bin = join(directory, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "curl"), CURL);
    await writeFile(join(bin, "node"), NODE);
    await chmod(join(bin, "curl"), 0o755);
    await chmod(join(bin, "node"), 0o755);
    const output = spawnSync("bash", ["-c", workflowRun()], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        NODE_LOG: join(directory, "node-invoked"),
        LIVE_JSON: JSON.stringify({ buildId: live }),
        DEPLOY_JSON: typeof deployJson === "function"
          ? deployJson(tip)
          : (deployJson ?? JSON.stringify({ deployments: [{ state, meta: { githubCommitSha: tip } }] })),
        PROJECT_ID: "prj_qa",
        TEAM_ID: "team_qa",
        VERCEL_TOKEN: "stub-vercel",
        ALERT_GITHUB_TOKEN: "stub-github",
        HYPERTASK_MCP_TOKEN: "stub-mcp",
        TG_TOKEN: "stub",
        TG_CHAT: "stub",
        RUNNER_TEMP: directory,
      },
    });
    const invoked = await readFile(join(directory, "node-invoked"), "utf8").catch(() => "");
    return { status: output.status, output: output.stdout + output.stderr, invoked };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a failed or in-flight build is not reported as deploy drift", async () => {
  const result = await run({ state: "ERROR" });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /failed; the build alarm covers it, so this is not drift/);
  assert.doesNotMatch(result.invoked, /production-alert\.mjs/);
  for (const state of ["BUILDING", "QUEUED"]) {
    const inFlight = await run({ state });
    assert.equal(inFlight.status, 0, inFlight.output);
    assert.match(inFlight.output, /a deploy is in flight/);
    assert.doesNotMatch(inFlight.invoked, /production-alert\.mjs/);
  }
});

test("a canceled build and a READY retry both keep the drift alarm", async () => {
  const canceled = await run({ state: "CANCELED" });
  assert.equal(canceled.status, 1, canceled.output);
  assert.match(canceled.output, /BEHIND the production tip/);
  assert.match(canceled.invoked, /production-alert\.mjs setup deploy-drift/);

  const retry = await run({
    deployJson: (tip) => JSON.stringify({
      deployments: [
        { state: "ERROR", meta: { githubCommitSha: tip } },
        { state: "READY", meta: { githubCommitSha: tip } },
      ],
    }),
  });
  assert.equal(retry.status, 1, retry.output);
  assert.match(retry.output, /BEHIND the production tip/);
  assert.match(retry.invoked, /production-alert\.mjs setup deploy-drift/);
});

test("a READY tip that an older deploy still shadows is still drift", async () => {
  const result = await run({ state: "READY" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /BEHIND the production tip/);
  assert.match(result.invoked, /production-alert\.mjs setup deploy-drift/);
});

test("an unreadable deployment list keeps the alarm instead of silencing it", async () => {
  for (const deployJson of ['{"deployments":null}', "not json"]) {
    const result = await run({ state: "ERROR", deployJson });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /BEHIND the production tip/);
    assert.match(result.invoked, /production-alert\.mjs setup deploy-drift/);
  }
});
