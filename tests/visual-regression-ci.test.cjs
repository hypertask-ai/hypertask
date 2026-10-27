const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function fixture({ fail, summaryOnly = false, summaryPath = "/summary.md" } = {}) {
  const filename = path.join(__dirname, "../scripts/visual-regression-ci.mjs");
  const code = readFileSync(filename, "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "").replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href));
  const calls = [];
  const logs = [];
  const files = new Map();
  const children = new Map();
  let elapsed = 0;
  let pid = 100;
  const env = { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: "/workspace", RUNNER_TEMP: "/temp", DATABASE_URL: "postgresql://127.0.0.1/fixture", REDIS_URL: "redis://localhost", GITHUB_STEP_SUMMARY: summaryPath };
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
    readFile: async () => { elapsed += 100; return JSON.stringify({ stats: { expected: 10 }, suites: [] }); },
    createRequire: () => name => {
      if (name === "@playwright/test/package.json") return { version: "1.64.0" };
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
  `${phase}: npx next build --webpack`,
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

test("a failed base build still reports elapsed work, distinguishes unreached phases, and remains a failure", async () => {
  const run = fixture({ fail: "base: npx next build --webpack" });
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
