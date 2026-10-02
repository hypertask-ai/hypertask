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
