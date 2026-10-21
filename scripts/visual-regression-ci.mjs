import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { appendFile, cp, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export function assertLocalCi(env) {
  if (env.GITHUB_ACTIONS !== "true" || !env.GITHUB_WORKSPACE || !env.RUNNER_TEMP) {
    throw new Error("Visual builds run only on a disposable GitHub Actions runner");
  }
  for (const key of ["DATABASE_URL", "REDIS_URL"]) {
    if (!["127.0.0.1", "localhost"].includes(new URL(env[key]).hostname)) {
      throw new Error(`${key} must use a disposable loopback service`);
    }
  }
}

export function captureArguments(phase) {
  if (!["base", "head"].includes(phase)) throw new Error("Unknown visual phase");
  return ["playwright", "test", "-c", "e2e/visual/playwright.visual.config.ts", `--update-snapshots=${phase === "base" ? "all" : "none"}`];
}

export function failedScreens(report) {
  const failed = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== "expected") failed.push(`${test.projectName}: ${spec.title}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(report);
  return failed;
}

function command(root, env, args, input) {
  const result = spawnSync(args[0], args.slice(1), { cwd: root, env, input, stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(root)}: ${args.slice(0, 3).join(" ")} failed`);
}

async function startServer(root, env, log) {
  const fd = openSync(log, "w", 0o600);
  const search = spawn(process.execPath, ["scripts/premerge-local-search.mjs", path.join(path.dirname(env.BROWSER_SMOKE_STATE_FILE), "card-fixture.json"), "53101"], { cwd: root, env, detached: true, stdio: ["ignore", fd, fd] });
  const server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", "3100"], { cwd: root, env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  let launchError;
  const processes = [server, search].map(child => {
    child.on("error", error => { launchError = error; });
    return { child, closed: new Promise(resolve => child.once("close", resolve)) };
  });
  const stop = async () => {
    await Promise.all(processes.map(async ({ child, closed }) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      const stopped = await Promise.race([closed.then(() => true), delay(5000).then(() => false)]);
      if (!stopped) {
        try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        await closed;
      }
    }));
  };
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (launchError) throw launchError;
      if (processes.some(({ child }) => child.exitCode !== null)) throw new Error("Local app or search stub exited before readiness");
      try {
        const response = await fetch(`${env.BASE_URL}/login`, { signal: AbortSignal.timeout(2000) });
        const searchResponse = await fetch(`${env.TURBOPUFFER_BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok && searchResponse.ok) return stop;
      } catch { /* The next readiness probe is bounded by the loop. */ }
      await delay(2000);
    }
    throw new Error("Local app did not become ready at /login");
  } catch (error) {
    await stop();
    throw error;
  }
}

async function summarize(workspace, temp) {
  const lines = ["## Visual Regression", "", "Base-generated expected PNGs → head comparison; Porcelain, desktop + phone, five screens each.", ""];
  for (const phase of ["base", "head"]) {
    let report;
    try {
      report = JSON.parse(await readFile(path.join(temp, `visual-${phase}.json`), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      lines.push(`- **${phase}**: setup/build failed or capture was not reached.`);
      continue;
    }
    const failures = failedScreens(report);
    const complete = report.stats?.expected === 10 && !report.stats?.skipped && !report.errors?.length;
    lines.push(`- **${phase}**: ${failures.length ? "failed screens" : complete ? "all 10 screens passed" : "capture incomplete or setup failed"}`);
    for (const screen of failures) lines.push(`  - ${screen.replace(/[\r\n`<>]/g, " ")}`);
  }
  lines.push("", "On failure, download **visual-regression-diffs** for expected/actual/diff PNGs and error-context.md (7 days). Traces, videos and storage state are never uploaded.", "Intended differences require a human-reviewed `Visual change approved: <ticket URL>` in the PR description; the job still reports the diff.", "");
  await appendFile(process.env.GITHUB_STEP_SUMMARY ?? path.join(workspace, "visual-summary.md"), lines.join("\n"));
}

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE;
  const temp = process.env.RUNNER_TEMP;
  if (process.argv.includes("--summary")) {
    if (!workspace || !temp) throw new Error("GitHub runner paths are required");
    await summarize(workspace, temp);
    return;
  }
  assertLocalCi(process.env);
  const head = path.join(workspace, "head");
  const base = path.join(workspace, "base");
  await cp(path.join(head, "e2e/visual"), path.join(base, "e2e/visual"), { recursive: true });
  await cp(path.join(head, "scripts/seed-browser-smoke.mjs"), path.join(base, "scripts/seed-browser-smoke.mjs"));
  const expected = path.join(temp, "visual-expected");
  await mkdir(expected, { recursive: true, mode: 0o700 });
  for (const phase of ["base", "head"]) {
    const root = path.join(workspace, phase);
    const stateDir = path.join(temp, `visual-${phase}`, "auth");
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const env = {
      ...process.env,
      BASE_URL: "http://127.0.0.1:3100",
      TZ: "UTC",
      BROWSER_SMOKE_STATE_FILE: path.join(stateDir, "smoke-state.json"),
      VISUAL_SNAPSHOT_DIR: expected,
      VISUAL_RESULTS_DIR: path.join(workspace, "test-results", "visual", phase),
      PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(temp, `visual-${phase}.json`),
    };
    command(root, env, ["npm", "ci", "--prefer-offline", "--no-audit", "--no-fund"]);
    const require = createRequire(path.join(root, "package.json"));
    if (require("@playwright/test/package.json").version !== "1.64.0") throw new Error("Visual captures require Playwright 1.64.0");
    command(root, env, ["npx", "prisma", "generate"]);
    command(root, env, ["npx", "prisma", "db", "execute", "--stdin"], "DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const Redis = require("ioredis");
    const redis = new Redis(env.REDIS_URL);
    try { await redis.flushdb(); } finally { redis.disconnect(); }
    command(root, env, ["npx", "prisma", "migrate", "deploy"]);
    command(root, env, ["node", "scripts/seed-browser-smoke.mjs", "--visual"]);
    command(root, env, ["npx", "next", "build", "--webpack"]);
    const stop = await startServer(root, env, path.join(temp, `visual-${phase}-server.log`));
    try {
      command(root, env, ["npx", ...captureArguments(phase)]);
      const report = JSON.parse(await readFile(env.PLAYWRIGHT_JSON_OUTPUT_NAME, "utf8"));
      if (report.stats?.expected !== 10 || report.stats?.skipped || report.errors?.length || failedScreens(report).length) {
        throw new Error(`${phase}: expected all ten visual screens to pass`);
      }
    } finally {
      await stop();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
