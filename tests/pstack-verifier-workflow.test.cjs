const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
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
  resolve: { contents: "read", "pull-requests": "read", actions: "read" },
  plan: { contents: "read" },
  drive: { contents: "read", packages: "read" },
  judge: { contents: "read", packages: "read", checks: "read", statuses: "read", actions: "read" },
  mark: { contents: "read", statuses: "read" },
  post: { actions: "read", contents: "read", "pull-requests": "write", statuses: "read" },
  cancel: { contents: "read", statuses: "read" },
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
  assert.deepEqual([needs(trusted.jobs.mark), needs(trusted.jobs.post)], [["resolve"], ["resolve", "judge", "mark"]]);
  assert.deepEqual(needs(trusted.jobs.cancel), ["resolve", "post"]);
  const secretJobs = Object.entries(trusted.jobs).filter(([, job]) => strings(job).some((value) => value.includes("secrets."))).map(([name]) => name);
  assert.deepEqual(secretJobs, ["plan", "judge", "mark", "post", "cancel"]);
  assert.equal(strings(trusted.jobs.drive).some((value) => value.includes("secrets.") || value.includes("OPENROUTER_EVAL_KEY")), false);
  assert.deepEqual(tokenGaps(trusted.jobs), []);
  assert.equal(trusted.jobs.cancel.steps.some((step) => String(step.uses ?? "").startsWith("actions/checkout")), true);
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
  assert.equal(policy.pstack_verifier.required, true);
  assert.equal(policy.pstack_verifier.note, "app 5264284 writes it from environment pstack-verifier on production");
  assert.equal(policy.required_checks.contexts.includes("pstack-verifier"), true);
  for (const name of ["post", "cancel"]) { assert.equal(trusted.jobs[name].if.includes("always()"), false); assert.match(trusted.jobs[name].if, /!cancelled\(\)/); }
  const { CI_WAIT_ROUNDS, CI_WAIT_INTERVAL_MS, REQUIRED_CI_CONTEXTS } = await import("../scripts/pstack-verifier.mjs");
  assert.equal(trusted.jobs.judge["timeout-minutes"] * 60 * 1000 > CI_WAIT_ROUNDS * CI_WAIT_INTERVAL_MS, true);
  assert.equal(REQUIRED_CI_CONTEXTS.includes("pstack-verifier"), false);
  const ruleset = new Set(policy.policies.production_ruleset.required_status_checks);
  assert.deepEqual([...ruleset], ["pstack-verifier"]);
  for (const name of REQUIRED_CI_CONTEXTS) assert.equal(ruleset.has(name), false, name);
  for (const name of ["ai-review", "claude-review", "app-smoke", "browser-smoke"]) assert.equal(REQUIRED_CI_CONTEXTS.includes(name), false, name);
  assert.equal(policy.required_checks.automerge_also_requires.includes("pstack-verifier"), true);
});

test("only mark, post and cancel use the verifier environment and the job token cannot write the status", () => {
  const named = readdirSync(".github/workflows").filter((name) => /\.ya?ml$/.test(name)).flatMap((file) => Object.entries(read(`.github/workflows/${file}`)?.jobs ?? {}).filter(([, job]) => (job.environment?.name ?? job.environment) === "pstack-verifier").map(([name]) => `${file}:${name}`));
  assert.deepEqual(named.sort(), ["pstack-verifier.yml:cancel", "pstack-verifier.yml:mark", "pstack-verifier.yml:post"]);
  const refs = (job) => (job.steps ?? []).filter((step) => String(step.uses ?? "").startsWith("actions/checkout")).map((step) => step.with?.ref ?? "");
  for (const name of ["mark", "post", "cancel"]) {
    assert.deepEqual(refs(trusted.jobs[name]), ["${{ github.sha }}"]);
    assert.equal(trusted.jobs[name].permissions.statuses, "read");
    assert.match(trusted.jobs[name].if, /github\.ref == 'refs\/heads\/production'/);
  }
  assert.equal(refs(trusted.jobs.drive).includes("${{ needs.resolve.outputs.sha }}"), true);
  assert.equal(strings(trusted.jobs.drive).some((value) => value.includes("HYPERTASK_RUNNERS_KEY")), false);
  assert.equal(strings(trusted.jobs.drive).some((value) => value.includes("secrets.")), false);
});

test("recheck waits on production, reruns only a verifier wait, and pages past a full run list", async () => {
  const recheck = read(".github/workflows/pstack-verifier-recheck.yml");
  assert.deepEqual(recheck.on.workflow_run.workflows, ["CI Tests", "PR Guards"]);
  assert.equal(recheck.on.workflow_run.workflows.includes("Pstack Verifier Request"), false);
  assert.deepEqual(recheck.jobs.recheck.permissions, { contents: "read", "pull-requests": "read", statuses: "read", actions: "write" });
  assert.equal(recheck.jobs.chain.permissions.actions, "write");
  assert.equal(recheck.jobs.chain.permissions.statuses, undefined);
  assert.match(recheck.jobs.chain.steps.at(-1).run, /--chain-events workflow_dispatch/);
  assert.match(recheck.jobs.chain.steps.at(-1).run, /--gap-minutes 30/);
  const enabled = (expr, env) => Function(`return (${expr
    .replaceAll("!cancelled()", "true")
    .replaceAll("github.event.workflow_run.event", JSON.stringify(env.workflowRunEvent ?? ""))
    .replaceAll("github.event_name", JSON.stringify(env.eventName))
    .replaceAll("github.ref", JSON.stringify(env.ref ?? ""))
    .replaceAll("==", "===")});`)();
  for (const job of Object.values(recheck.jobs)) assert.equal(enabled(job.if, { eventName: "workflow_dispatch", ref: "refs/heads/feature" }), false);
  assert.equal(enabled(recheck.jobs.recheck.if, { eventName: "workflow_dispatch", ref: "refs/heads/production" }), true);
  assert.equal(enabled(recheck.jobs.chain.if, { eventName: "workflow_run", workflowRunEvent: "pull_request" }), false);
  const helper = await import("../.github/scripts/pstack-verifier-recheck.mjs");
  const { CONTEXT } = await import("../scripts/pstack-verifier.mjs");
  assert.equal(helper.sourceStartsRecheck("Pstack Verifier Request"), false);
  assert.equal(helper.shouldRerun({ context: CONTEXT, state: "pending", description: "Planning a user check" }, { name: "Pstack Verifier Request", path: ".github/workflows/pstack-verifier-request.yml" }), false);
  assert.equal(helper.shouldRerun({ context: CONTEXT, state: "pending", description: "waiting for required checks" }, { path: ".github/workflows/pstack-verifier.yml" }), true);
  const verifierRun = { path: ".github/workflows/pstack-verifier.yml" };
  const unevaluatedStatus = { context: CONTEXT, state: "error", description: "verifier could not evaluate: model output invalid after retry" };
  assert.equal(helper.shouldRerun(unevaluatedStatus, verifierRun, [unevaluatedStatus]), true);
  assert.equal(helper.shouldRerun(unevaluatedStatus, verifierRun, [unevaluatedStatus, unevaluatedStatus, unevaluatedStatus]), false);
  assert.equal(helper.shouldRerun({ ...unevaluatedStatus, state: "failure" }, verifierRun, []), false);
  assert.equal(helper.shouldRerun(unevaluatedStatus, { path: ".github/workflows/other.yml" }, [unevaluatedStatus]), false);
  assert.equal(helper.workflowRunSha({ workflow_run: { name: "Pstack Verifier Request", event: "pull_request", head_sha: "a".repeat(40) } }), "");
  const oldest = "2026-11-17T01:00:00Z";
  const items = Array.from({ length: 31 }, (_, index) => ({ number: index + 1, waitingSince: index === 30 ? oldest : new Date(Date.parse("2026-11-17T02:00:00Z") + index * 1000).toISOString() }));
  assert.equal(helper.selectReruns(items)[0].number, 31);
  assert.equal(helper.selectReruns(items).length, 10);
  assert.equal(helper.selectReruns(items)[0].number, 31);
  const pulls = await helper.listProductionPulls(async (page) => page === 1
    ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1, state: "open", draft: false, base: { ref: "production" } }))
    : [{ number: 131, state: "open", draft: false, base: { ref: "production" } }]);
  assert.equal(pulls.length, 101);
  assert.equal(pulls.at(-1).number, 131);
  const { runInFlight, standDown, handOff } = require("../.github/scripts/schedule-chain.cjs");
  const page = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, status: "in_progress", event: "workflow_run" }));
  const api = async (path, method = "GET") => {
    if (method === "POST") return {};
    if (path.endsWith("per_page=30")) return { workflow_runs: page };
    if (path.includes("page=2")) return { workflow_runs: [{ id: 99, status: "in_progress", event: "workflow_dispatch" }] };
    return { workflow_runs: [] };
  };
  assert.equal((await runInFlight("hypertask-ai/hypertask", "pstack-verifier-recheck.yml", null, api, ["workflow_dispatch"])).id, 99);
  assert.equal((await standDown("hypertask-ai/hypertask", { workflowFile: "pstack-verifier-recheck.yml", api, chainEvents: ["workflow_dispatch"] })).id, 99);
  assert.equal(await standDown("hypertask-ai/hypertask", { workflowFile: "pstack-verifier-recheck.yml", api: async () => ({ workflow_runs: [] }), chainEvents: ["workflow_dispatch"] }), null);
  assert.equal((await handOff("hypertask-ai/hypertask", { workflowFile: "pstack-verifier-recheck.yml", api: async (path, method) => method === "POST" ? {} : { workflow_runs: [] }, chainEvents: ["workflow_dispatch"] })).dispatched, true);
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

function runCandidateSmoke(t, installed) {
  const dir = mkdtempSync(join(tmpdir(), "pstack-candidate-deps-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  const dockerLog = join(dir, "docker.log");
  const nodeLog = join(dir, "node.log");
  mkdirSync(bin);
  const app = join(dir, "candidate");
  mkdirSync(join(app, "scripts"), { recursive: true });
  if (installed) {
    mkdirSync(join(app, "node_modules"), { recursive: true });
    writeFileSync(join(app, "node_modules", ".package-lock.json"), "{}\n");
  }
  writeFileSync(join(bin, "docker"), dockerStub(dockerLog), { mode: 0o755 });
  writeFileSync(join(bin, "node"), nodeStub(nodeLog), { mode: 0o755 });
  const result = spawnSync("bash", [join(root, "scripts/run-app-smoke-isolated.sh"), app, app], {
    encoding: "utf8",
    timeout: 20000,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      PSTACK_VERIFIER_HOLD: "1",
      PSTACK_VERIFIER_READY: join(dir, "ready.env"),
      PSTACK_VERIFIER_STOP: join(dir, "stop"),
      PREVIEW_UP: "1",
      RUNNER_TEMP: dir,
      CORE_SMOKE_TRUSTED_DEPENDENCIES: "true",
      TMPDIR: dir,
    },
  });
  return { result, dockerLog, app };
}

test("a candidate checkout with an empty node_modules installs its own dependencies", (t) => {
  const { result, dockerLog } = runCandidateSmoke(t, false);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(dockerLog, "utf8").includes("run --rm --name ht-smoke-install-"), true);
});

test("a candidate checkout reuses dependencies only when they are installed", (t) => {
  const { result, dockerLog, app } = runCandidateSmoke(t, true);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const log = readFileSync(dockerLog, "utf8");
  assert.equal(log.includes("run --rm --name ht-smoke-install-"), false);
  assert.equal(log.includes(`${join(app, "node_modules")}:/app/node_modules:ro`), true);
});

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
  mkdirSync(join(dir, "trusted", "scripts", "lib"), { recursive: true });
  copyFileSync(join(root, "scripts/pstack-verifier.mjs"), join(dir, "trusted", "scripts", "pstack-verifier.mjs"));
  copyFileSync(join(root, "scripts/lib/pstack-journeys.cjs"), join(dir, "trusted", "scripts", "lib", "pstack-journeys.cjs"));
  copyFileSync(join(root, "scripts/lib/pstack-compare.cjs"), join(dir, "trusted", "scripts", "lib", "pstack-compare.cjs"));
  copyFileSync(join(root, "scripts/lib/pstack-ground.cjs"), join(dir, "trusted", "scripts", "lib", "pstack-ground.cjs"));
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
  assert.match(cli.stderr, /usage: pstack-verifier\.mjs resolve\|plan\|judge-ask\|judge\|mark\|post\|cancel\|base-plan/);
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
  mkdirSync(join(scripts, "lib"), { recursive: true });
  copyFileSync(join(root, "scripts/pstack-verifier-drive.mjs"), join(scripts, "pstack-verifier-drive.mjs"));
  copyFileSync(join(root, "scripts/pstack-verifier.mjs"), join(scripts, "pstack-verifier.mjs"));
  copyFileSync(join(root, "scripts/lib/pstack-journeys.cjs"), join(scripts, "lib", "pstack-journeys.cjs"));
  copyFileSync(join(root, "scripts/lib/pstack-compare.cjs"), join(scripts, "lib", "pstack-compare.cjs"));
  copyFileSync(join(root, "scripts/lib/pstack-ground.cjs"), join(scripts, "lib", "pstack-ground.cjs"));
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

test("the plan lane plans the head only and the drive lane never seeds a base result", () => {
  const steps = trusted.jobs.plan.steps;
  assert.equal(steps.some((step) => String(step.uses ?? "").startsWith("actions/cache/")), false);
  const planStep = steps.find((step) => String(step.run ?? "").includes("pstack-verifier.mjs plan"));
  assert.equal(planStep.env.PSTACK_VERIFIER_COMPARE, undefined);
  assert.equal(planStep.env.BASE_SHA, undefined);
  assert.equal(trusted.jobs.plan.outputs.baseNeeded, undefined);
  assert.deepEqual(Object.keys(trusted.jobs), ["resolve", "plan", "drive", "judge", "mark", "post", "cancel"]);
});

test("the judge asks the model first, then re-drives failed side journeys against the production base", () => {
  assert.deepEqual(Object.keys(trusted.on), ["workflow_run"]);
  const judge = trusted.jobs.judge;
  assert.equal(judge.permissions.actions, "read");
  const steps = judge.steps;
  const ask = steps.findIndex((step) => String(step.run ?? "").includes("pstack-verifier.mjs judge-ask"));
  const basePlan = steps.findIndex((step) => step.id === "base-plan" && String(step.run ?? "").includes("pstack-verifier.mjs base-plan"));
  const baseCheckout = steps.findIndex((step) => step.with?.path === "candidate-base");
  const baseDrive = steps.findIndex((step) => String(step.run ?? "").includes("candidate-base"));
  const decide = steps.findIndex((step) => String(step.run ?? "").trim().endsWith("pstack-verifier.mjs judge"));
  assert.equal(ask >= 0 && basePlan > ask && baseCheckout > basePlan && baseDrive > baseCheckout && decide > baseDrive, true);
  assert.equal(steps[ask].env.OPENROUTER_API_KEY, "${{ secrets.OPENROUTER_EVAL_KEY }}");
  assert.equal(steps[ask].if, "needs.plan.outputs.empty != 'true'");
  assert.equal(steps[baseCheckout].if, "steps.base-plan.outputs.needed == 'true'");
  assert.equal(steps[baseCheckout].with.ref, "${{ needs.resolve.outputs.base }}");
  assert.equal(steps[baseDrive].if, "steps.base-plan.outputs.needed == 'true'");
  assert.equal(steps[baseDrive]["continue-on-error"], true);
  assert.equal(steps[baseDrive].env.PSTACK_PLAN_FILE, "${{ runner.temp }}/pstack-verifier/plan/base-plan.json");
  assert.match(String(steps[baseDrive].run), /base-evidence\.json/);
  assert.equal(strings(trusted.jobs.drive).some((value) => value.includes("candidate-base") || value.includes("base-plan")), false);
});

test("the head evidence artifact is uploaded before the judge re-drives the base", () => {
  const steps = trusted.jobs.drive.steps;
  const upload = steps.findIndex((step) => String(step.with?.name ?? "").startsWith("pstack-evidence-"));
  assert.equal(upload, steps.length - 1);
  assert.equal(steps[upload].if, "always()");
  assert.equal(strings(trusted.jobs.drive).some((value) => value.includes("base-evidence")), false);
});
