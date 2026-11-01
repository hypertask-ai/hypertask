const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function fixture({ fail, summaryOnly = false, summaryPath = "/summary.md", cachedBase = false, baseOnly = false, corruptBaseline = false, webpackBase = false, playwrightVersions = { base: "1.64.1", head: "1.64.1" }, lockVersions = playwrightVersions } = {}) {
  const filename = path.join(__dirname, "../scripts/visual-regression-ci.mjs");
  const code = readFileSync(filename, "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "").replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href));
  const calls = [];
  const logs = [];
  const files = new Map();
  const children = new Map();
  let elapsed = 0;
  let pid = 100;
  const env = { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: "/workspace", RUNNER_TEMP: "/temp", DATABASE_URL: "postgresql://127.0.0.1/fixture", REDIS_URL: "redis://localhost", GITHUB_STEP_SUMMARY: summaryPath };
  if (cachedBase) env.VISUAL_BASE_CACHE_HIT = "true";
  if (baseOnly) env.VISUAL_BASE_ONLY = "true";
  const context = {
    path, pathToFileURL, URL, AbortSignal,
    performance: { now: () => elapsed },
    process: {
      env, argv: ["node", "fixture", ...(summaryOnly ? ["--summary"] : [])], execPath: "node",
      kill(childPid, signal) {
        elapsed += 100;
        calls.push(`stop ${signal}`);
        children.get(-childPid).emit("close", 0);
      },
    },
    console: { log: line => logs.push(line), error: message => { throw new Error(message); } },
    cp: async () => {}, mkdir: async () => {},
    openSync: () => 42, closeSync: () => {},
    appendFile: async (file, text) => files.set(file, (files.get(file) ?? "") + text),
    readFileSync: file => JSON.stringify({ packages: { "node_modules/@playwright/test": { version: lockVersions[path.basename(path.dirname(file))] } } }),
    readFile: async file => {
      if (file.endsWith("package.json")) {
        const webpack = webpackBase && path.basename(path.dirname(file)) === "base";
        return JSON.stringify({ scripts: { build: webpack ? "next build --webpack" : "next build" } });
      }
      if (file.endsWith(".png")) {
        const png = Buffer.alloc(24);
        Buffer.from("89504e470d0a1a0a", "hex").copy(png);
        png.writeUInt32BE(file.includes("/desktop/") ? 1440 : 390, 16);
        png.writeUInt32BE(corruptBaseline ? 1 : file.includes("/desktop/") ? 900 : 844, 20);
        return png;
      }
      elapsed += 100;
      return JSON.stringify({ stats: { expected: 10 }, suites: [] });
    },
    createRequire: root => name => {
      if (name === "@playwright/test/package.json") return { version: playwrightVersions[path.basename(path.dirname(root))] };
      if (name === "ioredis") return class {
        async flushdb() { elapsed += 1000; calls.push("flushdb"); }
        disconnect() { calls.push("disconnect"); }
      };
      throw new Error(`Unexpected require: ${name}`);
    },
    spawnSync: (bin, args, options) => {
      const phase = path.basename(options.cwd);
      const command = `${phase}: ${[bin, ...args].join(" ")}`;
      calls.push(command);
      if (args[0] === "next") elapsed += phase === "base" ? 60_000 : 120_000;
      else if (args[0] === "playwright") elapsed += phase === "base" ? 14_000 : 16_000;
      else elapsed += 2000;
      return { status: command === fail ? 1 : 0 };
    },
    spawn: () => {
      elapsed += 300;
      const child = new EventEmitter();
      child.pid = ++pid;
      child.exitCode = null;
      children.set(child.pid, child);
      calls.push("start server");
      return child;
    },
    fetch: async () => ({ ok: true }),
    delay: () => new Promise(() => {}),
  };
  const main = new Function(...Object.keys(context), `${code}\nreturn main;`)(...Object.values(context));
  return { main, calls, logs, files, elapsed: () => elapsed };
}

const commands = phase => [
  `${phase}: npm ci --prefer-offline --no-audit --no-fund`,
  `${phase}: npx prisma generate`,
  `${phase}: npx prisma db execute --stdin`,
  "flushdb", "disconnect",
  `${phase}: npx prisma migrate deploy`,
  `${phase}: node scripts/seed-browser-smoke.mjs --visual`,
  `${phase}: npx next build`,
  "start server", "start server",
  `${phase}: npx playwright test -c e2e/visual/playwright.visual.config.ts --update-snapshots=${phase === "base" ? "all" : "none"}`,
  "stop SIGTERM", "stop SIGTERM",
];

function rows(summary) {
  return [...summary.matchAll(/^\| (base build|base seed\+capture|head build|head seed\+capture|compare) \| (.+) \|$/gm)].map(match => [match[1], match[2]]);
}

test("five timing rows cover the entire unchanged paired lifecycle and match the single log line", async () => {
  const run = fixture();
  await run.main();
  assert.deepEqual(run.calls, [...commands("base"), ...commands("head")]);
  const summary = run.files.get("/summary.md");
  assert.deepEqual(rows(summary), [
    ["base build", "60.0 s"], ["base seed+capture", "25.9 s"],
    ["head build", "120.0 s"], ["head seed+capture", "11.8 s"], ["compare", "16.1 s"],
  ]);
  const sum = rows(summary).reduce((total, [, duration]) => total + parseFloat(duration), 0);
  assert.ok(Math.abs(sum - run.elapsed() / 1000) < 0.3);
  assert.match(summary, /Total measured step time: \*\*233.8 s\*\*/);
  assert.match(summary, /Build rows time only `next build`/);
  assert.match(summary, /captures and compares head screenshots in one command/);
  assert.deepEqual(run.logs, ["Visual Regression timings: base build=60.0 s; base seed+capture=25.9 s; head build=120.0 s; head seed+capture=11.8 s; compare=16.1 s; total=233.8 s"]);
});

test("an older baseline build command keeps webpack while the migrated head builds with Turbopack", async () => {
  const run = fixture({ webpackBase: true });
  await run.main();
  assert.deepEqual(run.calls.filter(call => call.includes(": npx next build")), [
    "base: npx next build --webpack",
    "head: npx next build",
  ]);
});

test("a failed base build still reports elapsed work, distinguishes unreached phases, and remains a failure", async () => {
  const run = fixture({ fail: "base: npx next build" });
  await assert.rejects(run.main(), /base: npx next build failed/);
  assert.deepEqual(rows(run.files.get("/summary.md")), [
    ["base build", "60.0 s"], ["base seed+capture", "11.0 s"],
    ["head build", "not reached"], ["head seed+capture", "not reached"], ["compare", "not reached"],
  ]);
  assert.deepEqual(run.calls, commands("base").slice(0, 8));
  assert.equal(run.logs.length, 1);
});

test("comparison failure keeps the original failure and server teardown while printing all five rows", async () => {
  const run = fixture({ fail: "head: npx playwright test -c e2e/visual/playwright.visual.config.ts --update-snapshots=none" });
  await assert.rejects(run.main(), /head: npx playwright test failed/);
  assert.deepEqual(run.calls, [...commands("base"), ...commands("head")]);
  assert.deepEqual(rows(run.files.get("/summary.md")), [
    ["base build", "60.0 s"], ["base seed+capture", "25.9 s"],
    ["head build", "120.0 s"], ["head seed+capture", "11.8 s"], ["compare", "16.0 s"],
  ]);
});

test("the later screen summary appends without duplicating the phase table or executing commands", async () => {
  const run = fixture({ summaryOnly: true });
  run.files.set("/summary.md", "existing timing table\n");
  await run.main();
  assert.match(run.files.get("/summary.md"), /^existing timing table\n## Visual Regression/);
  assert.match(run.files.get("/summary.md"), /\*\*base\*\*: all 10 screens passed/);
  assert.match(run.files.get("/summary.md"), /\*\*head\*\*: all 10 screens passed/);
  assert.deepEqual(rows(run.files.get("/summary.md")), []);
  assert.deepEqual(run.calls, []);
  assert.deepEqual(run.logs, []);
});

test("timings use the existing workspace fallback when GITHUB_STEP_SUMMARY is absent", async () => {
  const run = fixture({ summaryPath: null });
  await run.main();
  assert.equal(rows(run.files.get("/workspace/visual-summary.md")).length, 5);
});


test("an exact cache hit skips all base work, never skips head comparison, and does not report a base build", async () => {
  const run = fixture({ cachedBase: true });
  await run.main();
  assert.deepEqual(run.calls, commands("head"));
  assert.deepEqual(rows(run.files.get("/summary.md")), [
    ["base build", "not reached"], ["base seed+capture", "not reached"],
    ["head build", "120.0 s"], ["head seed+capture", "11.8 s"], ["compare", "16.1 s"],
  ]);
  assert.match(run.logs[0], /cache hit: ten validated screenshots/);
});

test("production warming captures base only; an ordinary miss still runs both lifecycles", async () => {
  const warm = fixture({ baseOnly: true });
  await warm.main();
  assert.deepEqual(warm.calls, commands("base"));
  assert.deepEqual(rows(warm.files.get("/summary.md")).slice(2), [
    ["head build", "not reached"], ["head seed+capture", "not reached"], ["compare", "not reached"],
  ]);
  const miss = fixture();
  await miss.main();
  assert.deepEqual(miss.calls, [...commands("base"), ...commands("head")]);
});

test("base and head must install one Playwright version so the screenshots compare", async () => {
  const run = fixture({ playwrightVersions: { base: "1.64.1", head: "1.64.2" } });
  await assert.rejects(run.main(), /base and head must capture with one Playwright version .*base has 1\.64\.1, head has 1\.64\.2/);
  assert.deepEqual(run.calls, [...commands("base"), `${commands("head")[0]}`]);
});

test("a cached baseline still needs head to match the base lockfile version", async () => {
  const run = fixture({ cachedBase: true, playwrightVersions: { base: "1.64.1", head: "1.64.2" } });
  await assert.rejects(run.main(), /base has 1\.64\.1, head has 1\.64\.2/);
  assert.deepEqual(run.calls, [commands("head")[0]]);
});

test("an install that disagrees with the checkout lockfile stops before captures", async () => {
  const run = fixture({ playwrightVersions: { base: "1.64.1", head: "1.64.2" }, lockVersions: { base: "1.64.1", head: "1.64.1" } });
  await assert.rejects(run.main(), /head installed Playwright 1\.64\.2 but its package-lock\.json locks 1\.64\.1/);
});

test("invalid cached PNG dimensions fail closed before any builds or comparisons", async () => {
  const run = fixture({ cachedBase: true, corruptBaseline: true });
  await assert.rejects(run.main(), /Invalid visual baseline: desktop\/board.png/);
  assert.deepEqual(run.calls, []);
});

test("a cached base cannot hide a failed head comparison", async () => {
  const run = fixture({ cachedBase: true, fail: "head: npx playwright test -c e2e/visual/playwright.visual.config.ts --update-snapshots=none" });
  await assert.rejects(run.main(), /head: npx playwright test failed/);
  assert.deepEqual(run.calls, commands("head"));
});

test("cache summary distinguishes reuse from a fresh base capture", async () => {
  const run = fixture({ cachedBase: true, summaryOnly: true });
  await run.main();
  assert.match(run.files.get("/summary.md"), /base\*\*: restored ten validated screenshots/);
  assert.match(run.files.get("/summary.md"), /head\*\*: all 10 screens passed/);
  assert.deepEqual(run.calls, []);
});


test("real PNG validation requires every screen, dimensions and PNG signature", async t => {
  const { mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
  const { tmpdir } = require("node:os");
  const { validateBaseline } = await import("../scripts/visual-regression-ci.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "visual-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [project, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    await mkdir(path.join(directory, project));
    for (const screen of ["board", "task-detail", "comment-box", "ctrl-j", "inbox"]) {
      const png = Buffer.alloc(24);
      Buffer.from("89504e470d0a1a0a", "hex").copy(png);
      png.writeUInt32BE(width, 16);
      png.writeUInt32BE(height, 20);
      await writeFile(path.join(directory, project, `${screen}.png`), png);
    }
  }
  await validateBaseline(directory);
  const missing = path.join(directory, "phone", "inbox.png");
  await rm(missing);
  await assert.rejects(validateBaseline(directory), { code: "ENOENT" });
  await writeFile(missing, Buffer.alloc(24));
  await assert.rejects(validateBaseline(directory), /Invalid visual baseline: phone\/inbox.png/);
  await writeFile(missing, Buffer.alloc(1));
  await assert.rejects(validateBaseline(directory), /Invalid visual baseline: phone\/inbox.png/);
});
