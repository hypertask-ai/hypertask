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
  assert.match(job, /postgres:16-bookworm@sha256:[a-f0-9]{64}/);
  assert.match(job, /redis:7-alpine@sha256:[a-f0-9]{64}/);
  assert.match(job, /quay\.io\/soketi\/soketi:[^@\s]+@sha256:[a-f0-9]{64}/);
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
  assert.match(seed, /description_:\s*\{\s*create: \{ content: "<p>[^<]+<\/p>", creatorId: ownerId/);
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
  assert.match(seed, /instantOpenControl \|\| allFlagsOn/);
  assert.match(seed, /prisma\.comment\.createMany/);
  assert.match(config, /prod\|layout-lock/);
  assert.match(layout, /\['direct', 'board card'\]/);
  assert.match(layout, /toHaveCount\(2\)/);
  assert.match(layout, /composer top must be below the last comment bottom/);
  assert.match(layout, /only the composer area may follow the last comment/);
  assert.match(layout, /toBeLessThanOrEqual\(640\)/);
});

test("browser fixture seeding rejects a nonlocal database before any write", () => {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/seed-browser-smoke.mjs"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgresql://smoke:smoke@example.invalid/smoke", BROWSER_SMOKE_STATE_FILE: "unused.json", GITHUB_OUTPUT: "unused.env" },
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
