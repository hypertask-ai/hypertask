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
