const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const root = join(__dirname, "..");

const read = (file) => yaml.load(readFileSync(file, "utf8"), { schema: yaml.JSON_SCHEMA });
const trusted = read(".github/workflows/pstack-verifier.yml");
const request = read(".github/workflows/pstack-verifier-request.yml");
const policy = read("docs/ci-policy.yml");
const expected = {
  resolve: { contents: "read", "pull-requests": "read", statuses: "write" },
  plan: { contents: "read" },
  drive: { contents: "read", packages: "read" },
  judge: { contents: "read", checks: "read", statuses: "read" },
  post: { contents: "read", "pull-requests": "write", statuses: "write" },
  cancel: { statuses: "write" },
};

function runParts(step) {
  return String(step?.run ?? "").split("&&").map((part) => part.trim()).filter((part) => part.length > 0);
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => strings(item, out));
  return out;
}
const needs = (job) => [].concat(job.needs ?? []);
function tokenGaps(jobs) {
  const gaps = [];
  for (const [name, job] of Object.entries(jobs)) {
    for (const [index, step] of (job.steps ?? []).entries()) {
      const run = String(step.run ?? "");
      const usesGithub = /\bgh\b|docker login|pstack-verifier\.mjs\s+(?:resolve|plan|judge|post)/.test(run);
      if (usesGithub && step.env?.GH_TOKEN !== "${{ github.token }}") gaps.push(`${name}:${index}`);
    }
  }
  return gaps;
}

test("drive generates the database client before the drive script runs", () => {
  const steps = trusted.jobs.drive.steps;
  const generateAt = steps.findIndex((step) => runParts(step).some((part) => part.split(" ").includes("prisma") && part.split(" ").includes("generate")));
  const driveAt = steps.findIndex((step) => runParts(step).some((part) => part.includes("pstack-verifier-job.sh")));
  assert.equal(generateAt >= 0, true);
  assert.equal(driveAt >= 0, true);
  assert.equal(generateAt < driveAt, true);
});

test("each verifier job has the declared permissions, key and token", async () => {
  assert.deepEqual(request.permissions, {});
  assert.deepEqual(trusted.permissions, {});
  for (const [name, permissions] of Object.entries(expected)) assert.deepEqual(trusted.jobs[name].permissions, permissions, name);
  assert.deepEqual(needs(trusted.jobs.plan), ["resolve"]);
  assert.deepEqual(needs(trusted.jobs.drive), ["resolve", "plan"]);
  assert.deepEqual(needs(trusted.jobs.judge), ["resolve", "plan", "drive"]);
  assert.deepEqual(needs(trusted.jobs.post), ["resolve", "judge"]);
  assert.deepEqual(needs(trusted.jobs.cancel), ["resolve", "post"]);
  const secretJobs = Object.entries(trusted.jobs).filter(([, job]) => strings(job).some((value) => value.includes("secrets."))).map(([name]) => name);
  assert.deepEqual(secretJobs, ["plan", "judge"]);
  assert.equal(strings(trusted.jobs.drive).some((value) => value.includes("secrets.") || value.includes("OPENROUTER_EVAL_KEY")), false);
  assert.deepEqual(tokenGaps(trusted.jobs), []);
  assert.equal(trusted.jobs.cancel.steps.some((step) => String(step.uses ?? "").includes("checkout")), false);
  const names = [];
  for (const job of Object.values(trusted.jobs)) {
    for (const step of job.steps ?? []) {
      const uses = String(step.uses ?? "");
      if (step.with?.name) names.push(step.with.name);
      if (uses.includes("artifact")) assert.ok(uses.startsWith("actions/upload-artifact@") || uses.startsWith("actions/download-artifact@"));
      assert.equal(String(step.run ?? "").includes("@actions/artifact"), false);
    }
  }
  assert.deepEqual(names.filter((name) => !name.includes("${{ github.run_id }}-${{ github.run_attempt }}")), []);
  assert.equal(policy.pstack_verifier.required, false);
  assert.equal(policy.pstack_verifier.note, "enable after hosted proof");
  assert.equal(policy.required_checks.contexts.includes("pstack-verifier"), false);
  for (const name of ["post", "cancel"]) { assert.equal(trusted.jobs[name].if.includes("always()"), false); assert.match(trusted.jobs[name].if, /!cancelled\(\)/); }
  const { CI_WAIT_ROUNDS, CI_WAIT_INTERVAL_MS, REQUIRED_CI_CONTEXTS } = await import("../scripts/pstack-verifier.mjs");
  assert.equal(trusted.jobs.judge["timeout-minutes"] * 60 * 1000 > CI_WAIT_ROUNDS * CI_WAIT_INTERVAL_MS, true);
  const liveRulesetContexts = [
    "app-smoke", "browser-smoke", "ci-tests", "ai-review", "claude-review",
    "feature-flag-gate", "pr-title", "next-public-secrets", "secret-scan",
  ];
  assert.deepEqual([...REQUIRED_CI_CONTEXTS].sort(), [...liveRulesetContexts].sort());
});

function dockerStub(log) {
  return `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = inspect ]; then
  printf 'true\\n'
elif [ "$1" = logs ]; then
  printf 'PostgreSQL init process complete; ready for start up.\\n'
fi
exit 0
`;
}

function nodeStub(log) {
  return `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [[ "$*" == *waitForPreview* ]]; then
  if [ "\${PREVIEW_UP:-}" = 1 ]; then
    touch "\$PSTACK_VERIFIER_STOP"
    exit 0
  fi
  exit 1
fi
exec ${JSON.stringify(process.execPath)} "$@"
`;
}

function runHeldSmoke(t, previewUp) {
  const dir = mkdtempSync(join(tmpdir(), "pstack-preview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  const dockerLog = join(dir, "docker.log");
  const nodeLog = join(dir, "node.log");
  mkdirSync(bin);
  mkdirSync(join(dir, "candidate"));
  mkdirSync(join(dir, "trusted", "scripts"), { recursive: true });
  writeFileSync(join(bin, "docker"), dockerStub(dockerLog), { mode: 0o755 });
  writeFileSync(join(bin, "node"), nodeStub(nodeLog), { mode: 0o755 });
  const ready = join(dir, "ready.env");
  const result = spawnSync("bash", [join(root, "scripts/run-app-smoke-isolated.sh"), join(dir, "candidate"), join(dir, "trusted")], {
    encoding: "utf8",
    timeout: 15000,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      PSTACK_VERIFIER_HOLD: "1",
      PSTACK_VERIFIER_READY: ready,
      PSTACK_VERIFIER_STOP: join(dir, "stop"),
      PREVIEW_UP: previewUp ? "1" : "0",
      RUNNER_TEMP: dir,
      CORE_SMOKE_TRUSTED_DEPENDENCIES: "false",
      TMPDIR: dir,
    },
  });
  return { result, dockerLog, nodeLog, ready, dir };
}

function assertRelayOwnsHostPort(log) {
  const lines = log.split("\n").filter((line) => line.length > 0);
  const app = lines.find((line) => line.includes("run -d --name ht-smoke-app-"));
  const relay = lines.find((line) => line.includes("run -d --name ht-smoke-relay-"));
  assert.equal(app?.includes("--network ht-smoke-net-"), true);
  assert.equal(app.includes("127.0.0.1:3100:3100"), false);
  assert.equal(lines.indexOf(relay) > lines.indexOf(app), true);
  assert.equal(relay?.includes("--network ht-smoke-publish-"), true);
  assert.equal(relay.includes("-p 127.0.0.1:3100:3100"), true);
  assert.equal(lines.some((line) => line.startsWith("network create --internal ht-smoke-net-")), true);
  assert.equal(lines.some((line) => line.startsWith("network create ht-smoke-publish-") && !line.includes("--internal")), true);
  assert.equal(lines.some((line) => line.startsWith("network connect ht-smoke-net-") && line.includes(" ht-smoke-relay-")), true);
}

test("the held smoke publishes the relay on the host and fails closed when the preview check fails", (t) => {
  const { result, dockerLog, nodeLog, ready } = runHeldSmoke(t, false);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr.includes("preview did not start"), true);
  assert.equal(existsSync(ready), false);
  const node = readFileSync(nodeLog, "utf8");
  assert.equal(node.includes("waitForPreview"), true);
  assert.equal(node.includes("pstack-verifier.mjs"), true);
  assertRelayOwnsHostPort(readFileSync(dockerLog, "utf8"));
});

test("the held smoke records the host preview url when the preview check passes", (t) => {
  const { result, ready, dir } = runHeldSmoke(t, true);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(ready, "utf8"), `url=http://127.0.0.1:3100\nenv=${join(dir, "smoke.env")}\n`);
});

function listenPreview(t) {
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(3100, "127.0.0.1", () => {
      t.after(() => new Promise((done) => server.close(done)));
      resolve();
    });
  });
}

test("a listening preview stays ready when node -e imports the verifier", async (t) => {
  await listenPreview(t);
  const dir = mkdtempSync(join(tmpdir(), "pstack-preview-live-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(join(dir, "candidate"));
  mkdirSync(join(dir, "trusted", "scripts"), { recursive: true });
  copyFileSync(join(root, "scripts/pstack-verifier.mjs"), join(dir, "trusted", "scripts", "pstack-verifier.mjs"));
  writeFileSync(join(bin, "docker"), dockerStub(join(dir, "docker.log")), { mode: 0o755 });
  const ready = join(dir, "ready.env");
  const stop = join(dir, "stop");
  writeFileSync(stop, "");
  const result = await new Promise((resolve) => {
    const child = spawn("bash", [join(root, "scripts/run-app-smoke-isolated.sh"), join(dir, "candidate"), join(dir, "trusted")], {
      env: {
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        PSTACK_VERIFIER_HOLD: "1",
        PSTACK_VERIFIER_READY: ready,
        PSTACK_VERIFIER_STOP: stop,
        RUNNER_TEMP: dir,
        CORE_SMOKE_TRUSTED_DEPENDENCIES: "false",
        TMPDIR: dir,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr.includes("preview did not start"), false);
  assert.equal(readFileSync(ready, "utf8"), `url=http://127.0.0.1:3100\nenv=${join(dir, "smoke.env")}\n`);
  const cli = spawnSync(process.execPath, [join(root, "scripts/pstack-verifier.mjs")], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /usage: pstack-verifier.mjs resolve\|plan\|judge\|post/);
});

function playwrightModules() {
  const candidates = [join(root, "node_modules"), join(process.env.HOME, "projects/hypertask/node_modules")];
  const found = candidates.find((dir) => existsSync(join(dir, "playwright", "package.json")));
  if (!found) throw new Error("playwright package is not installed");
  return found;
}

test("a smoke boot that never writes ready records a down preview", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const trusted = join(dir, "trusted");
  const scripts = join(trusted, "scripts");
  const work = join(dir, "work");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(dir, "candidate"));
  copyFileSync(join(root, "scripts/pstack-verifier-drive.mjs"), join(scripts, "pstack-verifier-drive.mjs"));
  copyFileSync(join(root, "scripts/pstack-verifier.mjs"), join(scripts, "pstack-verifier.mjs"));
  symlinkSync(playwrightModules(), join(trusted, "node_modules"));
  writeFileSync(join(scripts, "run-app-smoke-isolated.sh"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
  const result = spawnSync("bash", [join(root, "scripts/pstack-verifier-job.sh"), trusted, join(dir, "candidate"), work], {
    encoding: "utf8",
    timeout: 20000,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: process.env.HOME,
      HEAD_SHA: "abc123",
      GITHUB_RUN_ID: "42",
      GITHUB_RUN_ATTEMPT: "3",
      TMPDIR: dir,
    },
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(readFileSync(join(work, "evidence", "evidence.json"), "utf8")), {
    sha: "abc123",
    run: "42",
    attempt: "3",
    preview: "down",
    steps: [],
    expects: [],
    navigations: [],
    offOrigin: [],
  });
});
