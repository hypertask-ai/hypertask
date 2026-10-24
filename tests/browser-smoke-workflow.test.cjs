const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");

async function source(path) {
  return readFile(path, "utf8");
}

test("browser smoke exposes no repository or production credentials to PR code", async () => {
  const workflow = await source(".github/workflows/ci-tests.yml");
  const job = workflow.slice(
    workflow.indexOf("  browser-smoke:"),
    workflow.indexOf("  production-test-warning:"),
  );

  assert.ok(job.length > 0);
  // HR-04: agent (bot) PRs run the customer test too; no author exemption.
  assert.doesNotMatch(job, /user\.login/);
  assert.doesNotMatch(job, /\[bot\]/);
  // HR-04: no label gate either; a label-gated run shows SKIPPED, which counts as passing.
  assert.doesNotMatch(job, /full-ci/);
  assert.doesNotMatch(job, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(job, /\$\{\{\s*vars\./);
  assert.doesNotMatch(job, /SMOKE_PLAIN_SESSION_STATE/);
  assert.match(job, /ghcr\.io\/hypertask-ai\/ci-postgres:16-bookworm@sha256:[a-f0-9]{64}/);
  assert.match(job, /ghcr\.io\/hypertask-ai\/ci-redis:7-alpine@sha256:[a-f0-9]{64}/);
  assert.match(job, /ghcr\.io\/hypertask-ai\/ci-soketi:[^@\s]+@sha256:[a-f0-9]{64}/);
  assert.match(job, /health-cmd "wget [^"]+http:\/\/127\.0\.0\.1:6001"/);
  assert.match(job, /session_secret=\$\(openssl rand -hex 32\)/);
  assert.match(job, /printf '::add-mask::%s\\n' "\$session_secret"/);
  assert.match(job, /printf '::add-mask::%s\\n' "\$jwt_secret"/);
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
  const job = workflow.slice(workflow.indexOf("  browser-smoke:"), workflow.indexOf("  production-test-warning:"));
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
  const job = workflow.slice(workflow.indexOf("  browser-smoke:"), workflow.indexOf("  production-test-warning:"));
  const runs = job.match(/npx playwright test[^\n]*e2e\/smoke\/layout-lock\.spec\.ts/g);
  assert.equal(runs?.length, 2);
  assert.ok(job.indexOf(runs[0]) < job.indexOf("--all-flags-on"));
  assert.ok(job.indexOf(runs[1], job.indexOf("--all-flags-on")) > job.indexOf("--all-flags-on"));
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
  const job = workflow.slice(workflow.indexOf("  browser-smoke:"), workflow.indexOf("  production-test-warning:"));
  const runs = job.match(/npx playwright test[^\n]*e2e\/smoke\/layout-lock-matrix\.spec\.ts/g);
  assert.equal(runs?.length, 2);
  assert.ok(job.indexOf(runs[0]) < job.indexOf("--all-flags-on"));
  assert.ok(job.indexOf(runs[1], job.indexOf("--all-flags-on")) > job.indexOf("--all-flags-on"));
  assert.match(job, /name: Layout change needs a recorded approval[\s\S]*node \.github\/scripts\/layout-lock-approval\.mjs/);
  assert.match(job, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
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
  // YPER4-352: the contract blocks merges only because browser-smoke is required and fails with it.
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const policy = yaml.load(await source("docs/ci-policy.yml"));
  assert.ok(policy.required_checks.contexts.includes("browser-smoke"));
  const smoke = workflow.jobs["browser-smoke"];
  assert.notEqual(smoke["continue-on-error"], true);
  const step = smoke.steps.find(s => s.id === "smoke");
  assert.notEqual(step["continue-on-error"], true);
  assert.equal(step.if, "github.event_name == 'push' || steps.scope.outputs.build_needed == 'true'");
  assert.match(step.run, /^set -euo pipefail$/m);
  const lines = step.run.split("\n").filter(line => line.includes("scripts/mcp-cli-api-contract.mjs"));
  assert.equal(lines.length, 1, "the contract runs exactly once in the browser-smoke step");
  assert.match(lines[0], /^\s*node scripts\/mcp-cli-api-contract\.mjs\s*$/, "no || true, no &, no if around the contract");
  assert.doesNotMatch(step.run.slice(0, step.run.indexOf(lines[0])), /set \+e/);
});

test("MCP CLI API contract reuses smoke server before reseeding with explicit passed output", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const smoke = workflow.jobs["browser-smoke"];
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
  assert.ok(contract < serve.indexOf("--all-flags-on"));
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
  // YPER4-363: next/font fetches Google fonts at build time and that download flaked.
  const yaml = require("js-yaml");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const workflow = yaml.load(await source(".github/workflows/ci-tests.yml"));
  const step = workflow.jobs["browser-smoke"].steps.find((s) => s.name === "Build the local app (no migrations)");
  const run = (outcomes) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yper4-363-"));
    // Fake npx: each call takes the next outcome (ok, font, other) and counts calls.
    fs.writeFileSync(path.join(dir, "npx"), `#!/bin/bash
n=$(( $(cat "${dir}/calls" 2>/dev/null || echo 0) + 1 )); echo $n > "${dir}/calls"
case "$(sed -n "\${n}p" "${dir}/outcomes")" in
  ok) echo built; exit 0;;
  font) echo "TypeError at node_modules/next/dist/compiled/@next/font/dist/google/loader.js" >&2; echo "next/font/google failed" >&2; exit 1;;
  *) echo "Type error: something else" >&2; exit 1;;
esac
`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "outcomes"), outcomes.join("\n") + "\n");
    const child = spawnSync("bash", ["-c", step.run], { env: { PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir } });
    return { status: child.status, calls: Number(fs.readFileSync(path.join(dir, "calls"), "utf8")) };
  };
  assert.deepEqual(run(["ok"]), { status: 0, calls: 1 });
  assert.deepEqual(run(["font", "ok"]), { status: 0, calls: 2 });
  assert.deepEqual(run(["font", "font"]), { status: 1, calls: 2 });
  assert.deepEqual(run(["other", "ok"]), { status: 1, calls: 1 });
});

test("YPER4-629: required browser smoke runs the inbox cycle last, with every flag on and with live-like modes", async () => {
  const [workflow, seed, config, spec] = await Promise.all([
    source(".github/workflows/ci-tests.yml"),
    source("scripts/seed-browser-smoke.mjs"),
    source("playwright.config.smoke.ts"),
    source("e2e/smoke/inbox-cycle.spec.ts"),
  ]);
  const job = workflow.slice(workflow.indexOf("  browser-smoke:"), workflow.indexOf("  production-test-warning:"));
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
