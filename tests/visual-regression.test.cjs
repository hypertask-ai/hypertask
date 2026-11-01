const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");
const vm = require("node:vm");
const ts = require("typescript");
const yaml = require("js-yaml");

const source = file => readFileSync(path.join(__dirname, "..", file), "utf8");
const runner = import("../scripts/visual-regression-ci.mjs");

function loadConfig() {
  const code = ts.transpileModule(source("e2e/visual/playwright.visual.config.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: name => name === "@playwright/test" ? { defineConfig: config => config } : require(name),
    process: { env: { VISUAL_SNAPSHOT_DIR: "/expected", BROWSER_SMOKE_STATE_FILE: "/private/state.json" } },
  });
  return exports.default;
}

async function seed(visual) {
  const writes = new Map();
  const calls = [];
  let nextId = 0;
  let user;
  const prisma = new Proxy({ $disconnect: async () => {} }, {
    get(target, model) {
      if (model in target) return target[model];
      return {
        async create({ data }) {
          calls.push({ model, data });
          const row = { id: ++nextId, ...data };
          if (model === "user") {
            row.UserSetting = { id: ++nextId, ...data.UserSetting.create };
            user = row;
          }
          return row;
        },
        async createMany({ data }) { calls.push({ model, data }); },
        async update({ data }) { if (model === "user") Object.assign(user, data); },
        async findUnique() { return user; },
        async upsert() {},
      };
    },
  });
  const modules = file => {
    if (file.endsWith("prisma.ts")) return prisma;
    if (file.endsWith("modeCache.ts")) return { withFlagModeInvalidation: fn => fn() };
    if (file.endsWith("session.ts")) return { SESSION_TTL_SECONDS: 3600, signSession: () => "fake-session" };
    if (file.endsWith("flags.ts")) return { FEATURE_FLAG_KEYS: [], defaultFeatureFlagMode: () => "OFF" };
    if (file.endsWith("redis.ts")) return { getRedis: async () => ({ disconnect() {} }) };
    if (file.endsWith("verifyJwt.ts")) return { createMcpToken: () => "fake-agent-token", agentTokenCredentialFields: () => ({}) };
    throw new Error(`Unexpected mock module ${file}`);
  };
  const file = pathToFileURL(path.join(__dirname, "../scripts/seed-browser-smoke.mjs")).href;
  const code = source("scripts/seed-browser-smoke.mjs").replace(/^import .*;\n/gm, "").replaceAll("import.meta.url", JSON.stringify(file));
  const context = {
    appendFile: async () => {}, mkdir: async () => {},
    readFile: async () => JSON.stringify({ modes: {} }),
    writeFile: async (name, body, options) => writes.set(path.basename(name), { body: JSON.parse(body), options }),
    createRequire: () => () => () => modules,
    path, randomUUID: () => "random-run", fileURLToPath,
    QA_ACCOUNT_STATE: null, localFlagModes: null, readPlainQaFlags: null,
    process: { env: { BROWSER_SMOKE_STATE_FILE: "/private/smoke-state.json", GITHUB_OUTPUT: "/private/output", DATABASE_URL: "postgresql://localhost/fixture", REDIS_URL: "redis://localhost" }, argv: visual ? ["node", "seed", "--visual"] : ["node", "seed"], pid: 42 },
    console: { log() {} }, URL,
  };
  const execute = new Function(...Object.keys(context), `return (async () => { ${code} })()`);
  await execute(...Object.values(context));
  return { writes, calls };
}

test("workflow is informational, read-only, path-scoped and uses the smoke services/environment", () => {
  const workflow = source(".github/workflows/visual-regression.yml");
  assert.match(workflow, /name: Visual Regression/);
  assert.equal(yaml.load(workflow).on.pull_request, undefined);
  assert.deepEqual(yaml.load(workflow).on.push.branches, ["production"]);
  assert.match(workflow, /workflow_dispatch:[\s\S]*base:[\s\S]*default: production[\s\S]*head:/);
  const scope = source(".github/scripts/visual-change-scope.cjs");
  for (const pattern of ["src/app/**", "src/components/**", "src/hooks/**", "src/styles/**", "styles/**", "**/*.css", "tailwind.config.*", "public/**", "e2e/visual/**", "scripts/seed-browser-smoke.mjs", "scripts/visual-regression-ci.mjs", ".github/workflows/visual-regression.yml"]) assert.ok(scope.includes(`'${pattern}'`), pattern);
  for (const pattern of ["src/app/api/**", "**/*.md"]) assert.ok(scope.includes(`'${pattern}'`), pattern);
  const job = yaml.load(workflow).jobs["visual-regression"];
  assert.deepEqual(job.permissions, { contents: "read", packages: "read" });
  assert.doesNotMatch(workflow, /secrets\.|: write|workflow_run|pull_request_target/);
  const parsed = yaml.load(workflow);
  const evaluate = (expression, event, journey) => vm.runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), {
    github: { event_name: event, event: { pull_request: { number: event === "pull_request" ? 19 : null, draft: false } }, ref: "refs/heads/production" },
    inputs: { journey }, format: (template, value) => template.replace("{0}", value),
  });
  for (const [event, journey, group, cancel, visual, verify] of [
    ["push", "", "visual-regression-refs/heads/production", true, true, false],
    ["workflow_dispatch", "", "visual-regression-refs/heads/production", true, true, false],
    ["workflow_dispatch", "visual", "visual-regression-refs/heads/production", true, true, false],
    ["workflow_dispatch", "inbox-cycle", "verify-qa", false, false, true],
    ["workflow_dispatch", "inbox-cycle-broken", "verify-qa", false, false, true],
  ]) {
    assert.equal(evaluate(parsed.concurrency.group, event, journey), group);
    assert.equal(evaluate(parsed.concurrency["cancel-in-progress"], event, journey), cancel);
    assert.equal(evaluate(job.if, event, journey), visual);
    assert.equal(evaluate(parsed.jobs["verify-qa"].if, event, journey), verify);
  }
  assert.match(workflow, /name: visual-regression/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /timeout-minutes: 35/);
  assert.match(workflow, /node-version: \^24\.\d+\.\d+/);
  assert.match(workflow, /@playwright\/test@1\.64\.0/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha \|\| inputs\.base/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha \|\| inputs\.head/);
  assert.equal(job.steps.filter(step => step.with?.["persist-credentials"] === false).length, 2);
  const smoke = source(".github/workflows/ci-tests.yml");
  for (const service of ["postgres", "redis"]) {
    const image = workflow.match(new RegExp(`image: (ghcr\\.io/hypertask-ai/ci-${service}:[^\\n]+)`))[1];
    assert.ok(smoke.includes(image));
    assert.deepEqual(job.services[service], yaml.load(smoke).jobs["browser-smoke-desktop"].services[service]);
    assert.deepEqual(job.services[service], yaml.load(smoke).jobs["browser-smoke-mobile"].services[service]);
  }
  const credentials = text => text.slice(text.indexOf("      - name: Prepare disposable local credentials"), text.indexOf('          } >> "$GITHUB_ENV"') + '          } >> "$GITHUB_ENV"'.length)
    .split("\n").filter(line => !/^        if: /.test(line)).join("\n");
  assert.equal(credentials(workflow), credentials(smoke));
  const compareJob = yaml.load(smoke).jobs["visual-compare"];
  assert.deepEqual(compareJob.permissions, { contents: "read", packages: "read" });
  for (const service of ["postgres", "redis"]) assert.deepEqual(compareJob.services[service], job.services[service]);
  const smokeBlocks = smoke.split("      - name: Prepare disposable local credentials").slice(1)
    .map(block => block.slice(0, block.indexOf('          } >> "$GITHUB_ENV"')).split("\n").filter(line => !/^        if: /.test(line)).join("\n"));
  assert.equal(new Set(smokeBlocks).size, 1, "every smoke consumer must share one environment");
  assert.deepEqual(compareJob.steps.find(step => step.name === "Upload visual differences").with.path.trim().split("\n"), ["test-results/**/*.png", "test-results/**/error-context.md", "test-results/**/trace.zip"]);
  assert.match(workflow, /retention-days: 7/);
  assert.equal(job.steps.find(step => step.name === "Summarize failed screens").if, "always() && hashFiles('head/scripts/visual-regression-ci.mjs') != ''");
  assert.equal(compareJob.steps.find(step => step.name === "Summarize failed screens").if, "always() && steps.scope.outputs.visual_needed != 'false' && hashFiles('head/scripts/visual-regression-ci.mjs') != ''");
  assert.equal(compareJob.steps.find(step => step.name === "Upload visual differences").with["if-no-files-found"], "ignore");
  const required = yaml.load(source("docs/ci-policy.yml")).required_checks.contexts;
  assert.equal(required.includes("visual-regression"), false);
  assert.equal(required.includes("verify-qa"), false);
  assert.match(source("docs/ci.md"), /Visual change approved: <ticket URL>/);
  assert.doesNotMatch(source("docs/ci.md"), /visual\/harness\.mjs|visual\/baseline/);
});

test("baseline caches restore an exact production key and only production pushes save successful PNGs", () => {
  const workflow = yaml.load(source(".github/workflows/visual-regression.yml"));
  assert.deepEqual(workflow.on.push.branches, ["production"]);
  const steps = workflow.jobs["visual-regression"].steps;
  const restore = steps.find(step => step.id === "baseline-cache");
  assert.match(restore.uses, /^actions\/cache\/restore@[a-f0-9]{40}$/);
  assert.equal(restore.with.path, "${{ runner.temp }}/visual-expected");
  assert.equal(restore.with["restore-keys"], undefined);
  for (const input of ["runner.os", "runner.arch", "steps.baseline.outputs.image", "steps.baseline.outputs.sha", "head/e2e/visual/**", "head/scripts/seed-browser-smoke.mjs", "head/scripts/premerge-local-search.mjs", "head/scripts/visual-regression-ci.mjs", "head/.github/workflows/visual-regression.yml"]) assert.ok(restore.with.key.includes(input), input);
  const save = steps.find(step => step.name === "Save successful production baseline");
  assert.equal(save.if, "github.event_name == 'push' && steps.baseline-cache.outputs.cache-hit != 'true'");
  assert.match(save.uses, /^actions\/cache\/save@[a-f0-9]{40}$/);
  assert.equal(save.with.path, restore.with.path);
  assert.equal(save.with.key, "${{ steps.baseline-cache.outputs.cache-primary-key }}");
  assert.ok(steps.indexOf(save) > steps.findIndex(step => step.name === "Build and capture base, then compare head"));
});

test("paired lifecycle resets each schema, seeds both from the same harness, builds sequentially and never updates head snapshots", async () => {
  const { captureArguments, assertLocalCi } = await runner;
  assert.ok(captureArguments("base").includes("--update-snapshots=all"));
  assert.ok(captureArguments("head").includes("--update-snapshots=none"));
  assert.throws(() => captureArguments("other"));
  const env = { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: "/workspace", RUNNER_TEMP: "/temp", DATABASE_URL: "postgresql://127.0.0.1/db", REDIS_URL: "redis://localhost" };
  assert.doesNotThrow(() => assertLocalCi(env));
  assert.throws(() => assertLocalCi({ ...env, GITHUB_ACTIONS: "false" }));
  assert.throws(() => assertLocalCi({ ...env, DATABASE_URL: "postgresql://external.invalid/db" }));
  assert.throws(() => assertLocalCi({ ...env, REDIS_URL: "redis://external.invalid" }));
  const code = source("scripts/visual-regression-ci.mjs");
  const loop = code.slice(code.indexOf('for (const phase of ["base", "head"])', code.indexOf("async function main")));
  const steps = ['["npm", "ci"', '["npx", "prisma", "generate"]', '"DROP SCHEMA public CASCADE; CREATE SCHEMA public;"', 'redis.flushdb()', '["npx", "prisma", "migrate", "deploy"]', '["node", "scripts/seed-browser-smoke.mjs", "--visual"]', 'await buildArguments(root)', 'await startServer(', '...captureArguments(phase)', 'await stop()'];
  let previous = -1;
  for (const step of steps) { const index = loop.indexOf(step); assert.ok(index > previous, step); previous = index; }
  assert.match(code, /cp\(path\.join\(head, "e2e\/visual"\), path\.join\(base, "e2e\/visual"\)/);
  assert.match(code, /cp\(path\.join\(head, "scripts\/seed-browser-smoke\.mjs"\), path\.join\(base, "scripts\/seed-browser-smoke\.mjs"\)/);
  assert.match(code, /VISUAL_SNAPSHOT_DIR: expected/);
  assert.match(code, /report\.stats\?\.expected !== 10/);
  assert.match(code, /"premerge-local-search\.mjs"|"scripts\/premerge-local-search\.mjs"/);
});

test("capture config has exactly two DPR1 Chromium viewports and strict non-updating screenshot defaults", () => {
  const config = loadConfig();
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.updateSnapshots, "none");
  assert.equal(config.snapshotPathTemplate, "/expected/{projectName}/{arg}{ext}");
  assert.equal(JSON.stringify(config.projects.map(project => project.use.viewport)), JSON.stringify([{ width: 1440, height: 900 }, { width: 390, height: 844 }]));
  assert.equal(config.projects[1].use.isMobile, true);
  assert.equal(config.projects[1].use.hasTouch, true);
  assert.equal(config.use.browserName, "chromium");
  assert.equal(config.use.deviceScaleFactor, 1);
  assert.equal(config.use.actionTimeout, 15_000);
  assert.equal(config.use.navigationTimeout, 15_000);
  assert.equal(config.use.timezoneId, "UTC");
  assert.equal(config.use.locale, "en-US");
  assert.equal(config.use.reducedMotion, "reduce");
  assert.equal(config.use.trace, "retain-on-failure");
  for (const option of ["video", "screenshot"]) assert.equal(config.use[option], "off");
  assert.equal(JSON.stringify(config.expect.toHaveScreenshot), JSON.stringify({ animations: "disabled", caret: "hide", scale: "css", maxDiffPixelRatio: 0.01, threshold: 0.2 }));
});

test("five full-viewport screens use real theme/time, cached ticket navigation, loaded assets and three stable geometry samples without masks", () => {
  const spec = source("e2e/visual/visual.spec.ts");
  assert.match(spec, /const screens = \['board', 'task-detail', 'comment-box', 'ctrl-j', 'inbox'\]/);
  assert.match(spec, /page\.clock\.setFixedTime\(new Date\(fixture\.visualNow\)\)/);
  assert.match(spec, /addCookies\(\[\{ name: 'theme', value: 'porcelain'/);
  assert.match(spec, /toHaveAttribute\('data-theme', 'porcelain'\)/);
  assert.match(spec, /searchParams\.set\('realtime', 'off'\)/);
  assert.match(spec, /const card = await board\(page\)\s+const cardBox = \(await card\.boundingBox\(\)\)!\s+const clickPoint = \{ x: cardBox\.width \/ 2, y: cardBox\.height - 8 \}\s+await card\.click\(\{ position: clickPoint \}\)/);
  assert.match(spec, /expect\(hovercardAnchorsUnderClick, 'the card click point must not land on a hover card anchor of the opened ticket'\)\.toBe\(0\)/);
  assert.match(spec, /expect\(page\.getByRole\('dialog'\), 'no popup may cover the ticket'\)\.toHaveCount\(0\)/);
  assert.match(spec, /thread\.getByTestId\('ticket-comment'\)\s+await expect\(comments, 'both seeded comments must be mounted'\)\.toHaveCount\(2\)/);
  assert.match(spec, /document\.fonts\.ready/);
  assert.match(spec, /image\.decode\(\)/);
  assert.match(spec, /equalSamples >= 3/);
  assert.match(spec, /const SETTLE_JUMP_WARNING_PX = 20/);
  assert.match(spec, /largestJump\.pixels > SETTLE_JUMP_WARNING_PX\) \{[\s\S]*?annotations\.push\(\{ type: 'warning', description \}\)[\s\S]*?::warning title=/);
  assert.match(spec, /getByTestId\('ticket-comment'\)\.filter\(\{ hasText: 'Last layout lock comment' \}\)/);
  assert.match(spec, /expect\(lastComment, 'exactly one last seeded comment in the ticket thread'\)\.toHaveCount\(1\)/);
  assert.match(spec, /expect\(page\.getByTestId\('comment-composer'\), 'one desktop or phone composer'\)\.toHaveCount\(1\)/);
  assert.match(spec, /lastComment\.evaluate\(comment => comment\.scrollIntoView\(\{ behavior: 'instant', block: 'center' \}\), undefined, \{ timeout: 15_000 \}\)/);
  assert.match(spec, /if \(testInfo\.project\.name === 'desktop'\) \{\s+await composer\.evaluate\(element => element\.scrollIntoView\(\{ behavior: 'instant', block: 'nearest' \}\), undefined, \{ timeout: 15_000 \}\)/);
  assert.match(spec, /expect\(lastComment, 'last seeded comment must remain in viewport after scrolling'\)\.toBeInViewport\(\{ timeout: 15_000 \}\)/);
  assert.match(spec, /expect\(composer, 'comment composer must be in viewport after scrolling'\)\.toBeInViewport\(\{ timeout: 15_000 \}\)/);
  for (const step of ['open seeded ticket with its comments', 'scroll last seeded comment and composer into view', 'assets loaded and landmark geometry settled', 'desktop composer follows the last seeded comment']) {
    assert.ok(spec.includes(`test.step('${step}'`));
  }
  assert.equal((spec.match(/\}, \{ timeout: 15_000 \}\)/g) || []).length, 5);
  assert.ok(spec.includes("test.step('page height settles before scrolling to the last comment'"));
  assert.doesNotMatch(spec, /scrollIntoViewIfNeeded|parent\.scrollTop|scrollingElement|ticket-comment'\)\.last\(\)|data-task-composer-slot/);
  assert.match(spec, /keyboard\.press\('Control\+j'\)/);
  assert.match(spec, /navigate\(page, '\/inbox'\)/);
  assert.match(spec, /getByAltText\('Inbox zero reward background'\)/);
  assert.match(spec, /image\.complete\)/);
  assert.ok(spec.indexOf('image.complete)') < spec.indexOf('toHaveScreenshot('));
  assert.match(spec, /image\.currentSrc && image\.naturalWidth > 0/);
  assert.match(spec, /toHaveScreenshot\(`\$\{screen\}\.png`\)/);
  assert.doesNotMatch(spec, /mask:|clip:|fullPage:|networkidle|withRealtime|\.fill\(|\.submit\(/);
  assert.ok(spec.indexOf('toHaveScreenshot(') < spec.indexOf('desktop composer must follow'));
  assert.match(spec, /toBeGreaterThanOrEqual\(lastCommentBox!\.y \+ lastCommentBox!\.height\)/);
});

test("visual seed fixes visible identity/timestamps/avatars but retains real-time auth expiry and ordinary smoke behavior", async () => {
  const visual = await seed(true);
  const ordinary = await seed(false);
  const user = visual.calls.find(call => call.model === "user").data;
  assert.equal(user.displayName, "Visual regression user");
  assert.equal(user.email, "visual-user@example.invalid");
  assert.equal(user.photoURL, null);
  assert.equal(user.joinedAt.toISOString(), "2026-10-01T12:00:00.000Z");
  const task = visual.calls.find(call => call.model === "task").data;
  assert.equal(task.createdAt.toISOString(), "2026-10-01T12:00:00.000Z");
  assert.equal(task.updatedAt.toISOString(), "2026-10-01T12:00:00.000Z");
  const comments = visual.calls.find(call => call.model === "comment").data;
  assert.equal(comments[0].createdAt.toISOString(), "2026-10-01T11:58:00.000Z");
  assert.equal(comments[1].createdAt.toISOString(), "2026-10-01T11:59:00.000Z");
  const fixture = visual.writes.get("card-fixture.json").body;
  assert.equal(fixture.visualNow, "2026-10-01T12:00:00Z");
  assert.match(fixture.boardPath, /^\/project\?id=\d+&surface=board$/);
  for (const flag of ["htpr-6752-instant-ticket-open", "htpr-6899-stable-layout", "htpr-6929-compose-task-writer", "htpr-6937-new-task-window", "htpr-6891-phone-task-writer-sheet"]) assert.equal(fixture.flags[flag], true);
  const state = visual.writes.get("smoke-state.json");
  assert.equal(state.options.mode, 0o600);
  assert.ok(state.body.cookies[0].expires > Date.now() / 1000);
  assert.ok(state.body.cookies[0].expires < Date.now() / 1000 + 3601);
  const normalUser = ordinary.calls.find(call => call.model === "user").data;
  assert.equal(normalUser.displayName, "Browser smoke user");
  assert.match(normalUser.email, /^browser-smoke-42-1-random-run@example.invalid$/);
  assert.ok(!("photoURL" in normalUser));
  assert.ok(!("joinedAt" in normalUser));
  assert.ok(!("createdAt" in ordinary.calls.find(call => call.model === "task").data));
  assert.ok(!("visualNow" in ordinary.writes.get("card-fixture.json").body));
  assert.ok(!("boardPath" in ordinary.writes.get("card-fixture.json").body));
  assert.ok(!("searchRows" in ordinary.writes.get("card-fixture.json").body));
});

test("failure summaries enumerate failed viewport/screens, including skipped and timed-out captures", async () => {
  const { failedScreens } = await runner;
  const report = { suites: [{ suites: [{ specs: [
    { title: "board", tests: [{ projectName: "desktop", status: "expected" }] },
    { title: "task-detail", tests: [{ projectName: "desktop", status: "unexpected" }] },
    { title: "inbox", tests: [{ projectName: "phone", status: "skipped" }] },
  ] }] }] };
  assert.deepEqual(failedScreens(report), ["desktop: task-detail", "phone: inbox"]);
  assert.deepEqual(failedScreens({ suites: [] }), []);
});

test.after(() => console.log("visual regression tests passed"));
