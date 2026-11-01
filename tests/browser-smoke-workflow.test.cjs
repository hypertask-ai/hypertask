const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");

async function source(path) {
  return readFile(path, "utf8");
}

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const FONT_MISS_LOG = path.resolve("tests/fixtures/next-font-build-failure.log");

function runBuildStep(step, outcomes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyci-63-"));
  fs.mkdirSync(path.join(dir, "verify-qa"), { recursive: true });
  fs.writeFileSync(path.join(dir, "npx"), `#!/bin/bash
n=$(( $(cat "${dir}/calls" 2>/dev/null || echo 0) + 1 )); echo $n > "${dir}/calls"
case "$(sed -n "\${n}p" "${dir}/outcomes")" in
  ok) echo built; exit 0;;
  font) cat "${FONT_MISS_LOG}"; exit 1;;
  next) printf '%s\n' 'Failed to compile.' '' '\`next/font\` error:' 'Failed to fetch \`Inter\` from Google Fonts.'; exit 1;;
  *) echo "Type error: something else" >&2; exit 1;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "outcomes"), outcomes.join("\n") + "\n");
  const child = spawnSync("bash", ["-c", step.run], { cwd: dir, env: { PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir } });
  return { status: child.status, calls: Number(fs.readFileSync(path.join(dir, "calls"), "utf8")) };
}

const SHARDS = ["browser-smoke-desktop", "browser-smoke-mobile", "browser-smoke-matrix", "browser-smoke-flags"];

function browserHalf(workflow, key) {
  const markers = SHARDS.map((name) => `  ${name}:`).concat(["  browser-smoke:\n"]);
  const start = workflow.indexOf(`  ${key}:`);
  assert.ok(start > 0, key);
  const next = markers
    .map((marker) => workflow.indexOf(marker, start + 1))
    .filter((index) => index > start)
    .sort((a, b) => a - b)[0];
  return workflow.slice(start, next);
}

function browserHalves(workflow) {
  const halves = workflow.slice(
    workflow.indexOf("  browser-smoke-desktop:"),
    workflow.indexOf("  browser-smoke:\n"),
  );
  for (const name of SHARDS) assert.ok(halves.includes(`  ${name}:`), name);
  return halves;
}

test("browser smoke exposes no repository or production credentials to PR code", async () => {
  const workflow = await source(".github/workflows/ci-tests.yml");
  const job = browserHalves(workflow);

  assert.ok(job.length > 0);
  assert.doesNotMatch(job, /user\.login/);
  assert.doesNotMatch(job, /\[bot\]/);
  assert.doesNotMatch(job, /full-ci/);
  assert.doesNotMatch(job, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(job, /\$\{\{\s*vars\./);
  assert.doesNotMatch(job, /SMOKE_PLAIN_SESSION_STATE/);
  assert.match(job, /ghcr\.io\/hypertask-ai\/ci-postgres:16-bookworm@sha256:[a-f0-9]{64}/);
  assert.match(job, /ghcr\.io\/hypertask-ai\/ci-redis:7-alpine@sha256:[a-f0-9]{64}/);
  assert.match(job, /ghcr\.io\/hypertask-ai\/ci-soketi:[^@\s]+@sha256:[a-f0-9]{64}/);
  assert.match(job, /health-cmd "wget [^"]+http:\/\/127\.0\.0\.1:6001"/);
  assert.match(job, /seed="\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}-smoke"/);
  assert.match(job, /session_secret=\$\(printf '%s' "\$seed:session" \| sha256sum \| cut -d' ' -f1\)/);
  assert.match(job, /printf '::add-mask::%s\\n' "\$session_secret"/);
  assert.match(job, /printf '::add-mask::%s\\n' "\$jwt_secret"/);
  assert.doesNotMatch(job, /openssl rand/);
  assert.match(job, /REDIS_URL=redis:\/\/127\.0\.0\.1:6379/);
  assert.match(job, /QSTASH_CALLBACK_BASE_URL=http:\/\/127\.0\.0\.1:3100/);
  assert.match(job, /QSTASH_AUTO_REGISTER_SWEEP=false/);
  assert.match(job, /npx prisma migrate deploy/);
  assert.match(job, /node scripts\/seed-browser-smoke\.mjs/);
});

test("browser smoke creates a fresh verified session without logging it", async () => {
  const [seed, setup] = await Promise.all([
    source("scripts/seed-browser-smoke.mjs"),
    source("e2e/smoke/global-setup.ts"),
  ]);

  assert.match(seed, /signSession\(\{ id: user\.id, email: user\.email \}\)/);
  assert.match(seed, /onboardingTourStatus: true/);
  assert.match(seed, /onboardingTutorialStatus: true/);
  assert.match(seed, /writeFile\(stateFile, JSON\.stringify\(state\), \{[\s\S]*mode: 0o600/);
  assert.match(seed, /board_path=\/project\?id=\$\{board\.id\}&surface=board/);
  assert.match(seed, /prisma\.user_Activity\.create/);
  assert.match(seed, /prisma\.team_Activity\.create/);
  assert.match(seed, /prisma\.userPicture\.create/);
  assert.match(seed, /JSON\.stringify\(sessionUser\)/);
  assert.doesNotMatch(seed, /console\.(?:log|error)\([^)]*(?:state|session|cookie|token)/i);
  assert.match(setup, /import \{ verifySession \} from '\.\.\/\.\.\/src\/lib\/auth\/session'/);
  assert.match(setup, /const session = verifySession\(token\)/);
  assert.doesNotMatch(setup, /token\?\.split\('\.'\)\[0\]/);
});

test("required browser smoke clicks its seeded ticket under live modes and the instant-open control", async () => {
  const [workflow, seed, smoke, snapshotSource] = await Promise.all([
    source(".github/workflows/ci-tests.yml"),
    source("scripts/seed-browser-smoke.mjs"),
    source("e2e/smoke/prod.spec.ts"),
    source("e2e/smoke/production-flag-modes.json"),
  ]);
  const snapshot = JSON.parse(snapshotSource);
  assert.equal(snapshot.source, "https://app.hypertask.ai/api/admin/flags");
  assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)));
  assert.ok(Object.values(snapshot.modes).includes("EVERYONE"), "released flags cannot all default off");
  for (const mode of Object.values(snapshot.modes)) {
    assert.ok(["OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"].includes(mode));
  }
  const job = browserHalves(workflow);
  assert.match(job, /name: browser-smoke/);
  assert.match(job, /node scripts\/seed-browser-smoke\.mjs --instant-open-control/);
  assert.match(job, /playwright test[^\n]+--grep 'seeded board card opens'/);
  assert.match(seed, /prisma\.featureFlag\.upsert/);
  assert.match(seed, /mode === "EVERYONE"/);
  assert.match(seed, /descriptionHtml = "<p>[^<]+<\/p>"/);
  assert.match(seed, /description_:\s*\{\s*create: \{ content: descriptionHtml, creatorId: ownerId/);
  assert.match(seed, /taskId: board\.task\.id/);
  assert.match(seed, /detailPath: `\/detail\/project-\$\{board\.id\}\/\$\{board\.task\.uniqueIndex\}`/);
  assert.match(smoke, /width: 1440, height: 900/);
  assert.match(smoke, /width: 390, height: 844/);
  assert.match(smoke, /page\.route\('\*\*\/api\/pages\/list\?\*', \(\) => \{\}\)/);
  assert.match(smoke, /await card\.click\(\)/);
  assert.match(smoke, /toHaveURL\(\(url\) => url\.pathname === fixture\.detailPath/);
  assert.match(smoke, /expect\(flags\[key\]/);
  assert.match(smoke, /expect\(title\)\.toHaveValue\(fixture\.title\)/);
  assert.match(smoke, /expect\(description,[^\n]+\.toBeVisible\(\)/);
  assert.match(smoke, /Date\.now\(\) \+ 3_000/);
  assert.match(smoke, /request\.isNavigationRequest\(\)/);
  assert.match(smoke, /expect\(documentRequests,[^\n]+\.toBe\(0\)/);
});

test("required browser smoke runs layout lock with live modes and every registry flag enabled", async () => {
  const [workflow, seed, config, layout] = await Promise.all([
    source(".github/workflows/ci-tests.yml"),
    source("scripts/seed-browser-smoke.mjs"),
    source("playwright.config.smoke.ts"),
    source("e2e/smoke/layout-lock.spec.ts"),
  ]);
  const liveRun = /npx playwright test[^\n]*e2e\/smoke\/layout-lock\.spec\.ts/g;
  const beforeFlags = [];
  const afterFlags = [];
  for (const key of SHARDS) {
    const half = browserHalf(workflow, key);
    let flagSeedAt = Infinity;
    const seed = /seed-browser-smoke\.mjs --all-flags-on/.exec(half);
    if (seed) flagSeedAt = seed.index;
    for (const run of half.matchAll(liveRun)) {
      (run.index < flagSeedAt ? beforeFlags : afterFlags).push(run[0]);
    }
  }
  for (const projects of [["Desktop"], ["Mobile"]]) {
    const filter = projects.map((project) => `--project=${project}`).join(" ");
    assert.ok(beforeFlags.some((run) => run.includes(filter)), `no live-mode layout lock for ${projects}`);
    assert.ok(afterFlags.some((run) => run.includes(filter)), `no every-flag-on layout lock for ${projects}`);
  }
  assert.match(seed, /FEATURE_FLAG_KEYS\.map\(key => \[key, "EVERYONE"\]\)/);
  assert.match(seed, /instantOpenControl \|\| allFlagsOn \|\| liveLikeControl/);
  assert.match(seed, /process\.argv\.includes\("--live-like-control"\)/);
  assert.match(seed, /modes\[key\] === "EVERYONE" \? "EVERYONE" : "OFF"/);
  assert.match(seed, /prisma\.comment\.createMany/);
  assert.match(config, /prod\|layout-lock/);
  assert.match(layout, /\['direct', 'board card'\]/);
  assert.match(layout, /toHaveCount\(2\)/);
  assert.match(layout, /composer top must be below the last comment bottom/);
  assert.match(layout, /only the composer area may follow the last comment/);
  assert.match(layout, /toBeLessThanOrEqual\(640\)/);
});

test("required browser smoke runs the layout lock matrix in both flag runs and checks layout approvals", async () => {
  const [workflow, config, spec, lib] = await Promise.all([
    source(".github/workflows/ci-tests.yml"),
    source("playwright.config.smoke.ts"),
    source("e2e/smoke/layout-lock-matrix.spec.ts"),
    source("e2e/smoke/lib/layout-lock-matrix.ts"),
  ]);
  const job = browserHalf(workflow, "browser-smoke-matrix");
  const desktop = browserHalf(workflow, "browser-smoke-desktop");
  const runs = job.match(/npx playwright test[^\n]*e2e\/smoke\/layout-lock-matrix\.spec\.ts/g);
  assert.equal(runs?.length, 2);
  assert.ok(job.indexOf(runs[0]) < job.indexOf("--all-flags-on"));
  assert.ok(job.indexOf(runs[1], job.indexOf("--all-flags-on")) > job.indexOf("--all-flags-on"));
  assert.match(desktop, /name: Layout change needs a recorded approval[\s\S]*node \.github\/scripts\/layout-lock-approval\.mjs/);
  assert.match(desktop, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(job, /name: Upload layout lock screenshots[\s\S]*test-results\/layout-lock-matrix\//);
  assert.match(config, /name: 'Matrix', testMatch: \/layout-lock-matrix/);
  assert.match(lib, /MATRIX_WIDTHS = \[1920, 1440, 1280, 1100, 950, 768, 390\]/);
  for (const page of ["ticket-short-thread", "ticket-long-thread", "name: 'board'", "name: 'inbox'", "name: 'search'"]) assert.ok(spec.includes(page), page);
  assert.match(spec, /requestAnimationFrame/);
  assert.match(spec, /LAYOUT_LOCK_MATRIX_UPDATE/);
});

test("browser fixture seeding rejects a nonlocal database before any write", () => {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/seed-browser-smoke.mjs"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: `postgresql://${["smoke", "smoke"].join(":")}@example.invalid/smoke`, BROWSER_SMOKE_STATE_FILE: "unused.json", GITHUB_OUTPUT: "unused.env" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Browser smoke seeding requires an isolated loopback database/);
});

test("automated realtime opt-in is limited to the isolated local smoke", async () => {
  const [client, smoke, inbox] = await Promise.all([
    source("src/lib/realtime/client.ts"),
    source("e2e/smoke/prod.spec.ts"),
    source("src/app/inbox/Inbox.tsx"),
  ]);

  assert.match(client, /browser\.location\.hostname === "127\.0\.0\.1"/);
  assert.match(client, /browser\.location\.hostname === "localhost"/);
  assert.match(client, /localSmokePreference === "on" && localSmokeOrigin/);
  assert.match(client, /if \(browser\.navigator\.webdriver\) \{/);
  assert.match(client, /HeadlessChrome\|PhantomJS/);
  assert.match(smoke, /pusher_internal:subscription_succeeded/);
  assert.match(smoke, /realtimeSubscriptions\.has\(`private-project-\$\{projectId\}`\)/);
  assert.match(smoke, /lastBoardFetchAt === 0 \? 1_000 : Date\.now\(\) - lastBoardFetchAt/);
  assert.match(smoke, /boardFetches\.clear\(\)/);
  assert.match(
    inbox,
    /<div className="relative group">\s*<Tooltip[\s\S]{0,500}<RemindMeInbox/,
  );
  assert.doesNotMatch(smoke, /allowLocalHydrationRecovery/);
  assert.doesNotMatch(smoke, /Minified React error #418/);
});

test("MCP CLI API contract stays fatal inside the required browser-smoke job", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const policy = yaml.load(await source("docs/ci-policy.yml"));
  assert.ok(policy.required_checks.contexts.includes("browser-smoke"));
  const smoke = workflow.jobs["browser-smoke-desktop"];
  assert.notEqual(smoke["continue-on-error"], true);
  const step = smoke.steps.find(s => s.id === "smoke");
  assert.notEqual(step["continue-on-error"], true);
  assert.equal(step.if, "github.event_name == 'push' || steps.scope.outputs.heavy_needed == 'true'");
  assert.match(step.run, /^set -euo pipefail$/m);
  const lines = step.run.split("\n").filter(line => line.includes("scripts/mcp-cli-api-contract.mjs"));
  assert.equal(lines.length, 1, "the contract runs exactly once in the browser-smoke step");
  assert.match(lines[0], /^\s*node scripts\/mcp-cli-api-contract\.mjs\s*$/, "no || true, no &, no if around the contract");
  assert.doesNotMatch(step.run.slice(0, step.run.indexOf(lines[0])), /set \+e/);
});

test("MCP CLI API contract reuses smoke server before reseeding with explicit passed output", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const smoke = workflow.jobs["browser-smoke-desktop"];
  assert.equal(smoke.outputs.contract, "${{ steps.smoke.outputs.contract }}");
  const fixtures = smoke.steps.find(step => step.id === "fixtures");
  assert.equal(fixtures.env.MCP_CLI_API_CONTRACT, "1");
  const prepare = smoke.steps.find(step => step.name === "Prepare disposable local credentials").run;
  assert.match(prepare, /TURBOPUFFER_BASE_URL=http:\/\/127\.0\.0\.1:53101/);
  assert.match(prepare, /NEXT_PUBLIC_BASEURL=http:\/\/127\.0\.0\.1:3100/);
  const serve = smoke.steps.find(step => step.id === "smoke").run;
  assert.match(serve, /set -euo pipefail/);
  assert.match(serve, /node scripts\/premerge-local-search\.mjs e2e\/smoke\/\.state\/card-fixture\.json 53101/);
  assert.match(serve, /kill "\$server" "\$search"/);
  const contract = serve.indexOf("node scripts/mcp-cli-api-contract.mjs");
  assert.ok(contract > serve.indexOf("Local app did not become ready"));
  assert.ok(contract < serve.indexOf("npx playwright test"));
  assert.ok(contract < serve.indexOf("--instant-open-control"));
  const cli = smoke.steps.find(step => step.name === "Download checksum-verified pinned native CLI");
  const productionCli = workflow.jobs["production-cli-parity"].env;
  assert.equal(cli.env.TRUSTED_CLI_BINARY_VERSION, productionCli.TRUSTED_CLI_BINARY_VERSION);
  assert.equal(cli.env.TRUSTED_CLI_BINARY_SHA256, productionCli.TRUSTED_CLI_BINARY_SHA256);
  assert.match(cli.run, /sha256sum --check/);
  assert.match(cli.run, /MCP_CONTRACT_CLI=/);
  const seed = await source("scripts/seed-browser-smoke.mjs");
  assert.match(seed, /const contractEnabled = process\.env\.MCP_CLI_API_CONTRACT === "1"/);
  assert.match(seed, /if \(contractEnabled\) \{/);
  assert.match(seed, /"guest", "unaccepted"/);
  assert.match(seed, /status: "Accepted"/);
  assert.match(seed, /contract-fixture\.json[\s\S]*mode: 0o600/);
  assert.match(seed, /contract\?\.boards/);
  const runner = await source("scripts/mcp-cli-api-contract.mjs");
  assert.match(runner, /appendFile\(process\.env\.GITHUB_OUTPUT, "contract=passed\\n"\)/);
  assert.match(runner, /config\/descriptions/);
});

test("required contract summary needs successful smoke and explicit contract or docs-only output", async () => {
  const yaml = require("js-yaml");
  const { spawnSync } = require("node:child_process");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const gate = workflow.jobs["mcp-cli-api-contract"];
  assert.equal(gate.name, "mcp-cli-api-contract");
  assert.equal(gate.needs, "browser-smoke");
  assert.equal(gate.if, "always()");
  assert.equal(gate.steps[0].env.SMOKE_RESULT, "${{ needs.browser-smoke.result }}");
  assert.equal(gate.steps[0].env.CONTRACT_RESULT, "${{ needs.browser-smoke.outputs.contract }}");
  for (const result of ["success", "failure", "skipped", "cancelled", ""]) {
    for (const output of ["passed", "failed", ""]) {
      for (const docsOnly of ["true", "false", ""]) {
        const child = spawnSync("bash", ["-c", gate.steps[0].run], { env: { PATH: process.env.PATH, SMOKE_RESULT: result, CONTRACT_RESULT: output, DOCS_ONLY: docsOnly } });
        assert.equal(child.status === 0, result === "success" && (output === "passed" || docsOnly === "true"), `${result}/${output}/${docsOnly}`);
      }
    }
  }
});

test("browser smoke retries its build once, only after a Google font download failure", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const step = workflow.jobs["browser-build"].steps.find((s) => s.name === "Build the local app (no migrations)");
  const run = (outcomes) => runBuildStep(step, outcomes);
  assert.deepEqual(run(["ok"]), { status: 0, calls: 1 });
  assert.deepEqual(run(["font", "ok"]), { status: 0, calls: 2 });
  assert.deepEqual(run(["font", "font"]), { status: 1, calls: 2 });
  assert.deepEqual(run(["next", "ok"]), { status: 0, calls: 2 });
  assert.deepEqual(run(["other", "ok"]), { status: 1, calls: 1 });
});

test("every build retry guard retries the log a real font failure prints", async () => {
  const yaml = require("js-yaml");
  const [ciTests, pilot, verifyQa] = await Promise.all([
    source(".github/workflows/ci-tests.yml"),
    source(".github/workflows/e2e-ai-pilot.yml"),
    source(".github/workflows/visual-regression.yml"),
  ]);
  const buildStep = (workflow, job, name) => yaml.load(workflow).jobs[job].steps.find((s) => s.name === name);
  const steps = [
    buildStep(ciTests, "browser-build", "Build the local app (no migrations)"),
    buildStep(pilot, "pilot", "Build the local app (no migrations)"),
    buildStep(verifyQa, "verify-qa", "Build once"),
  ];
  assert.equal(steps.filter(Boolean).length, 3);
  for (const step of steps) {
    assert.deepEqual(runBuildStep(step, ["font", "ok"]), { status: 0, calls: 2 });
    assert.deepEqual(runBuildStep(step, ["next", "ok"]), { status: 0, calls: 2 });
    assert.deepEqual(runBuildStep(step, ["font", "font"]), { status: 1, calls: 2 });
    assert.deepEqual(runBuildStep(step, ["other", "ok"]), { status: 1, calls: 1 });
  }
});

test("YPER4-629: required browser smoke runs the inbox cycle last, with every flag on and with live-like modes", async () => {
  const [workflow, seed, config, spec] = await Promise.all([
    source(".github/workflows/ci-tests.yml"),
    source("scripts/seed-browser-smoke.mjs"),
    source("playwright.config.smoke.ts"),
    source("e2e/smoke/inbox-cycle.spec.ts"),
  ]);
  const job = browserHalf(workflow, "browser-smoke-flags");
  const runs = [...job.matchAll(/npx playwright test[^\n]*e2e\/smoke\/inbox-cycle\.spec\.ts/g)].map((match) => match.index);
  assert.equal(runs.length, 2);
  const allFlagsOn = job.indexOf("--all-flags-on");
  const liveLike = job.indexOf("--live-like-control");
  assert.ok(allFlagsOn < runs[0] && runs[0] < liveLike && liveLike < runs[1]);
  assert.ok(job.lastIndexOf("layout-lock-matrix.spec.ts") < runs[0], "layout lock must not see the seeded inbox");
  for (const run of runs) assert.ok(job.lastIndexOf("--inbox-cycle", run) > job.lastIndexOf("npx playwright test", run - 1));
  assert.match(seed, /process\.argv\.includes\("--inbox-cycle"\)/);
  assert.match(seed, /type: "TaskReminder"/);
  assert.match(seed, /inboxAdvanceOnSend: true/);
  assert.match(config, /name: 'Inbox', testMatch: \/inbox-cycle\\\.spec\\\.ts\/, retries: 0/);
  assert.match(spec, /getByText\(items\[1\]\.title\)\.first\(\)\.click\(\)/);
  assert.match(spec, /searchParams\.get\('inboxFlow'\)/);
  for (const key of ["'j'", "'e'", "'Control+Enter'", "'Enter'"]) assert.ok(spec.includes(key), key);
});

test("required smoke reporting preserves newest-head verdicts and skips superseded or cancelled work", async (t) => {
  const yaml = require("js-yaml");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const workflow = yaml.load(await source(".github/workflows/app-smoke.yml"));
  const report = workflow.jobs.report;
  assert.match(report.if, /always\(\) && !cancelled\(\)/);
  assert.match(report.if, /needs\.validate\.outputs\.superseded != 'true'/);
  assert.equal(report.permissions["pull-requests"], "read");
  const step = report.steps[0];
  assert.equal(step.env.HEAD_SHA, "${{ needs.validate.outputs.head-sha || github.event.workflow_run.head_sha }}");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-smoke-report-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$CALLS"
case "$*" in
  "api repos/hypertask-ai/hypertask/pulls/1517") cat "$PULL_FIXTURE" ;;
  "api --method POST repos/hypertask-ai/hypertask/statuses/"*) echo '{}' ;;
  "workflow run automerge.yml "*) exit 0 ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`, { mode: 0o755 });
  const sha = "a".repeat(40);
  for (const fixture of [
    { smoke: "success", validation: "success", expected: "success", description: "Real build and eight core actions passed" },
    { smoke: "failure", validation: "success", expected: "failure", description: "App smoke failed" },
    { smoke: "skipped", validation: "failure", expected: "failure", description: "App smoke failed" },
    { smoke: "skipped", validation: "success", docsOnly: "true", expected: "success", description: "docs-only change, skipped" },
    { smoke: "cancelled", validation: "success" },
    { smoke: "failure", validation: "success", currentSha: "b".repeat(40) },
    { smoke: "success", validation: "success", currentSha: "b".repeat(40) },
    { smoke: "skipped", validation: "success", docsOnly: "true", currentSha: "b".repeat(40) },
    { smoke: "failure", validation: "success", state: "closed" },
  ]) {
    const label = JSON.stringify(fixture);
    const callsFile = path.join(dir, "calls");
    const pullFixture = path.join(dir, "pull.json");
    fs.writeFileSync(callsFile, "");
    fs.writeFileSync(pullFixture, JSON.stringify({ state: fixture.state ?? "open", head: { sha: fixture.currentSha ?? sha } }));
    const result = spawnSync("bash", ["-c", step.run], {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH}`, REPO: "hypertask-ai/hypertask", PR: "1517", HEAD_SHA: sha,
        VALIDATION_RESULT: fixture.validation, SMOKE_RESULT: fixture.smoke, DOCS_ONLY: fixture.docsOnly ?? "false",
        CALLS: callsFile, PULL_FIXTURE: pullFixture,
      },
    });
    assert.equal(result.status, 0, `${label}: ${result.stdout}${result.stderr}`);
    const calls = fs.readFileSync(callsFile, "utf8");
    if (!fixture.expected) {
      assert.doesNotMatch(calls, /statuses\/|workflow run/, label);
      continue;
    }
    assert.match(calls, new RegExp(`statuses/${sha} -f state=${fixture.expected} -f context=app-smoke`), label);
    assert.ok(calls.includes(`-f description=${fixture.description}`), label);
    assert.ok(calls.indexOf("pulls/1517") < calls.indexOf("statuses/"), label);
    assert.match(calls, /workflow run automerge\.yml/, label);
  }
});

test("every required PR smoke spec navigates through the shared readiness gate", async () => {
  const workflow = await source(".github/workflows/ci-tests.yml");
  const job = browserHalves(workflow);
  assert.ok(job.length > 0, "the browser smoke halves are missing from ci-tests.yml");
  const specs = [...new Set(job.match(/e2e\/smoke\/[\w.-]+\.spec\.ts/g) ?? [])].sort();
  assert.deepEqual(
    specs,
    [
      "e2e/smoke/agent-sidebar-chats.spec.ts",
      "e2e/smoke/inbox-cycle.spec.ts",
      "e2e/smoke/layout-lock-matrix.spec.ts",
      "e2e/smoke/layout-lock.spec.ts",
      "e2e/smoke/prod.spec.ts",
    ],
    "a browser smoke half runs a spec this gate has never covered (HYCI-41): list it here and take its test from ./lib/appReady",
  );
  const gate = await source("e2e/smoke/lib/appReady.ts");

  for (const spec of specs) {
    const body = await source(spec);
    assert.match(body, /from '\.\/lib\/appReady'/, `${spec} does not use the shared navigation gate`);
    assert.doesNotMatch(body, /import \{ test, expect[^}]*\} from '@playwright\/test'/, `${spec} bypasses the shared navigation gate`);
  }

  assert.match(gate, /__reactFiber\$/, "the gate does not prove React hydration");
  assert.match(gate, /MutationObserver/, "the gate does not wait for the document to stop changing");
  assert.match(gate, /page\.goto =/, "the gate does not wrap page.goto");
  assert.match(gate, /page\.reload =/, "the gate does not wrap page.reload");
  assert.match(gate, /timeout: MAX_WAIT_MS/, "the gate has no bounded wait");
});

test("HYCI-32: the required browser-smoke context is a summary over two parallel halves", async () => {
  const yaml = require("js-yaml");
  const { spawnSync } = require("node:child_process");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const aggregate = workflow.jobs["browser-smoke"];
  const desktop = workflow.jobs["browser-smoke-desktop"];
  const mobile = workflow.jobs["browser-smoke-mobile"];

  const build = workflow.jobs["browser-build"];
  assert.deepEqual(aggregate.needs, ["browser-build", ...SHARDS]);
  const shards = SHARDS.map((key) => workflow.jobs[key]);
  assert.deepEqual(shards.map((shard) => shard.needs), SHARDS.map(() => "browser-build"));
  for (const shard of shards) {
    assert.equal(shard.if, desktop.if);
    assert.match(shard.if, /pull_request\.draft == false/);
    assert.ok(shard["timeout-minutes"] <= 20);
    assert.ok(shard.steps.some((step) => step.name === "Download the one build"));
    assert.ok(!shard.steps.some((step) => step.name === "Upload the one build"));
  }
  assert.equal(build.steps.filter((step) => step.name === "Upload the one build").length, 1);
  for (const shard of shards.slice(1)) {
    assert.ok(!shard.steps.some((step) => step.name === "Download checksum-verified pinned native CLI"));
  }
  assert.equal(aggregate.outputs.contract, "${{ needs.browser-smoke-desktop.outputs.contract }}");
  assert.equal(aggregate.outputs.docs_only, "${{ needs.browser-smoke-desktop.outputs.docs_only }}");
  assert.equal(workflow.jobs["mcp-cli-api-contract"].needs, "browser-smoke");
  assert.deepEqual(workflow.jobs["visual-compare"].needs, ["browser-build"]);

  const step = aggregate.steps[0];
  const env = ["BUILD", "DESKTOP", "MOBILE", "MATRIX", "FLAGS"];
  for (const [name, key] of env.map((name, index) => [name, ["browser-build", ...SHARDS][index]])) {
    assert.equal(step.env[name], "${{ needs." + key + ".result }}", name);
  }
  for (const results of [
    ["success", "success", "success", "success", "success"],
    ["failure", "success", "success", "success", "success"],
    ["success", "success", "failure", "success", "success"],
    ["success", "success", "success", "failure", "success"],
    ["success", "success", "success", "success", "cancelled"],
    ["success", "success", "success", "skipped", "success"],
    ["skipped", "skipped", "skipped", "skipped", "skipped"],
  ]) {
    const child = spawnSync("bash", ["-c", step.run], {
      env: { PATH: process.env.PATH, ...Object.fromEntries(env.map((name, index) => [name, results[index]])) },
    });
    assert.equal(child.status === 0, results.every((result) => result === "success"), results.join("/"));
  }
});

test("HYCI-32: the two halves split the browser projects with nothing lost and nothing run twice", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const config = await source("playwright.config.smoke.ts");
  assert.match(config, /workers: 4/);

  const seen = new Map();
  for (const key of SHARDS) {
    const serve = workflow.jobs[key].steps.find((step) => step.id === "smoke").run;
    let state = "default";
    let liveLike = false;
    for (const line of serve.split("\n")) {
      const seed = line.match(/seed-browser-smoke\.mjs (--[a-z-]+)/);
      if (seed) {
        if (seed[1] === "--live-like-control") liveLike = true;
        else state = seed[1].slice(2);
        continue;
      }
      const run = line.match(/npx playwright test[^\n]*$/);
      if (!run) continue;
      const projects = [...run[0].matchAll(/--project=([A-Za-z-]+)/g)].map((match) => match[1]);
      assert.ok(projects.length > 0, `${key} runs a project filter on every playwright line: ${line}`);
      const label = liveLike ? `live-like+${state}` : state;
      for (const project of projects) {
        const id = `${label}/${project}`;
        assert.equal(seen.has(id), false, `${id} runs in both halves`);
        seen.set(id, key);
      }
    }
  }

  const expected = [
    "default/Desktop",
    "default/Mobile",
    "default/Matrix",
    "instant-open-control/Desktop",
    "instant-open-control/Mobile",
    "all-flags-on/Desktop",
    "all-flags-on/Mobile",
    "all-flags-on/Matrix",
    "inbox-cycle/Inbox",
    "live-like+inbox-cycle/Inbox",
  ].sort();
  assert.deepEqual([...seen.keys()].sort(), expected);
});

test("HYCI-32: the two halves never publish an artifact under one name", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const names = [];
  for (const key of ["browser-build", ...SHARDS]) {
    for (const step of workflow.jobs[key].steps) {
      if (!step.uses?.startsWith("actions/upload-artifact@")) continue;
      assert.ok(step.with?.name, `${key} uploads an artifact with no name`);
      names.push(step.with.name);
    }
  }
  assert.ok(names.length >= SHARDS.length);
  assert.deepEqual(new Set(names).size, names.length, `duplicate artifact names: ${names.join(", ")}`);
  assert.ok(names.includes("app-build"));
});

test("HYCI-32: a half that starts the fixture search server asks the seed for search rows", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const seed = await source("scripts/seed-browser-smoke.mjs");
  const halves = SHARDS;
  const searchRowSwitches = ["BROWSER_SMOKE_SEARCH_FIXTURES", "MCP_CLI_API_CONTRACT"];

  const unaskedHalves = (jobs) => halves.filter((key) => {
    const serve = jobs[key].steps.find((step) => step.id === "smoke").run;
    if (!serve.includes("scripts/premerge-local-search.mjs")) return false;
    const fixtures = jobs[key].steps.find((step) => step.id === "fixtures");
    const env = fixtures.env ?? {};
    return !searchRowSwitches.some((name) => env[name] === "1");
  });

  assert.deepEqual(unaskedHalves(workflow.jobs), []);
  for (const key of halves) {
    const serve = workflow.jobs[key].steps.find((step) => step.id === "smoke").run;
    assert.match(serve, /premerge-local-search\.mjs e2e\/smoke\/\.state\/card-fixture\.json 53101/, key);
  }
  assert.equal(workflow.jobs["browser-smoke-desktop"].steps.find((step) => step.id === "fixtures").env.MCP_CLI_API_CONTRACT, "1");
  assert.match(seed, /const searchFixtures = process\.env\.BROWSER_SMOKE_SEARCH_FIXTURES === "1"/);
  assert.match(seed, /localPremerge \|\| contractEnabled \|\| visual \|\| searchFixtures/);

  const stripped = structuredClone(workflow.jobs);
  delete stripped["browser-smoke-mobile"].steps.find((step) => step.id === "fixtures").env.BROWSER_SMOKE_SEARCH_FIXTURES;
  assert.deepEqual(unaskedHalves(stripped), ["browser-smoke-mobile"]);
});

test("HYCI-62: every page shard restores the pinned Chromium before installing it", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const CACHE_SHA = "0057852bfaa89a56745cba8c7296529d2fc39830";
  const BROWSERS = "~/.cache/ms-playwright";
  const CACHE_KEY = "playwright-chromium-${{ runner.os }}-${{ hashFiles('package-lock.json') }}";
  const byName = (job, name) => job.steps.find((step) => step.name === name);

  for (const key of SHARDS) {
    const job = workflow.jobs[key];
    const restore = byName(job, "Restore Playwright browser cache");
    assert.ok(restore, key);
    assert.equal(restore.uses, `actions/cache/restore@${CACHE_SHA}`, key);
    assert.equal(restore.with.path, BROWSERS, key);
    assert.equal(restore.with.key, CACHE_KEY, key);
    assert.equal(job.steps.indexOf(byName(job, "Generate client and install Chromium")), job.steps.indexOf(restore) + 1, key);
  }

  const savers = SHARDS.filter((key) => byName(workflow.jobs[key], "Save Playwright browser cache"));
  assert.deepEqual(savers, ["browser-smoke-desktop"], "one saver only, so four shards never race one key");
  const save = byName(workflow.jobs["browser-smoke-desktop"], "Save Playwright browser cache");
  assert.equal(save.uses, `actions/cache/save@${CACHE_SHA}`);
  assert.equal(save.with.path, BROWSERS);
  assert.equal(save.with.key, CACHE_KEY);
  assert.match(save.if, /steps\.restore-playwright-browsers\.outputs\.cache-hit != 'true'/);
  assert.ok(
    workflow.jobs["browser-smoke-desktop"].steps.indexOf(save) >
      workflow.jobs["browser-smoke-desktop"].steps.indexOf(byName(workflow.jobs["browser-smoke-desktop"], "Generate client and install Chromium")),
  );
});
