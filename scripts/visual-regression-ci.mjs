import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { appendFile, cp, mkdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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

export function headBuildMode(env) {
  const mode = env.VISUAL_HEAD_BUILD || "local";
  if (!["local", "artifact"].includes(mode)) throw new Error(`Unknown VISUAL_HEAD_BUILD: ${mode}`);
  return mode;
}

export function assertSharedHeadBuild(root) {
  const buildId = path.join(root, ".next", "BUILD_ID");
  if (!existsSync(buildId)) throw new Error("The shared app build is missing: head/.next/BUILD_ID was not downloaded");
  return readFileSync(buildId, "utf8").trim();
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

export function lockedPlaywright(root) {
  const version = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")).packages?.["node_modules/@playwright/test"]?.version;
  if (!version) throw new Error(`${path.basename(root)}/package-lock.json locks no @playwright/test version`);
  return version;
}

export function assertSamePlaywright(baseVersion, headVersion) {
  if (baseVersion !== headVersion) {
    throw new Error(`base and head must capture with one Playwright version so the pixels compare: base has ${baseVersion}, head has ${headVersion}. A Playwright change needs new production baselines.`);
  }
}

export async function validateBaseline(directory) {
  for (const [project, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    for (const screen of ["board", "task-detail", "comment-box", "ctrl-j", "inbox"]) {
      const file = path.join(directory, project, `${screen}.png`);
      const png = await readFile(file);
      if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
        throw new Error(`Invalid visual baseline: ${project}/${screen}.png`);
      }
    }
  }
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
      } catch {  }
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
  if (headBuildMode(process.env) === "artifact") {
    lines.push("- **head build**: reused the one app build from `app-build`; no second `next build`.", "");
  }
  for (const phase of ["base", "head"]) {
    if (phase === "base" && process.env.VISUAL_BASE_CACHE_HIT === "true") {
      await validateBaseline(path.join(temp, "visual-expected"));
      lines.push("- **base**: restored ten validated screenshots from the exact production cache key.");
      continue;
    }
    if (phase === "head" && process.env.VISUAL_BASE_ONLY === "true") continue;
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

export async function buildArguments(root) {
  const manifest = await readFile(path.join(root, "package.json"), "utf8").catch(() => "{}");
  const build = JSON.parse(manifest).scripts?.build ?? "";
  return build.includes("next build --webpack") ? ["npx", "next", "build", "--webpack"] : ["npx", "next", "build"];
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
  const headBuild = headBuildMode(process.env);
  const headsShareOneBuild = headBuild === "artifact";
  const phases = headsShareOneBuild
    ? ["base build", "base seed+capture", "head seed+capture", "compare"]
    : ["base build", "base seed+capture", "head build", "head seed+capture", "compare"];
  const timings = new Map(phases.map(phase => [phase, null]));
  let currentPhase = process.env.VISUAL_BASE_CACHE_HIT === "true" ? "head seed+capture" : "base seed+capture";
  let phaseStarted = performance.now();
  const recordPhase = nextPhase => {
    const now = performance.now();
    timings.set(currentPhase, (timings.get(currentPhase) ?? 0) + now - phaseStarted);
    currentPhase = nextPhase;
    phaseStarted = now;
  };
  let basePlaywright;
  try {
    const head = path.join(workspace, "head");
    const base = path.join(workspace, "base");
    await cp(path.join(head, "e2e/visual"), path.join(base, "e2e/visual"), { recursive: true });
    await cp(path.join(head, "scripts/seed-browser-smoke.mjs"), path.join(base, "scripts/seed-browser-smoke.mjs"));
    const expected = path.join(temp, "visual-expected");
    await mkdir(expected, { recursive: true, mode: 0o700 });
    const cachedBase = process.env.VISUAL_BASE_CACHE_HIT === "true";
    if (cachedBase) basePlaywright = lockedPlaywright(base);
    if (cachedBase) {
      await validateBaseline(expected);
      console.log("Visual base cache hit: ten validated screenshots; skipping base build and capture");
    }
    for (const phase of ["base", "head"]) {
      if (phase === "base" && cachedBase) continue;
      if (phase === "head" && process.env.VISUAL_BASE_ONLY === "true") continue;
      recordPhase(`${phase} seed+capture`);
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
      const playwright = require("@playwright/test/package.json").version;
      const locked = lockedPlaywright(root);
      if (playwright !== locked) throw new Error(`${phase} installed Playwright ${playwright} but its package-lock.json locks ${locked}`);
      if (phase === "base") basePlaywright = playwright;
      else assertSamePlaywright(basePlaywright ?? lockedPlaywright(base), playwright);
      command(root, env, ["npx", "prisma", "generate"]);
      command(root, env, ["npx", "prisma", "db", "execute", "--stdin"], "DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      const Redis = require("ioredis");
      const redis = new Redis(env.REDIS_URL);
      try { await redis.flushdb(); } finally { redis.disconnect(); }
      command(root, env, ["npx", "prisma", "migrate", "deploy"]);
      command(root, env, ["node", "scripts/seed-browser-smoke.mjs", "--visual"]);
      if (phase === "head" && headsShareOneBuild) {
        assertSharedHeadBuild(root);
        console.log("Visual head reuses the one app build from app-build; no second next build");
      } else {
        recordPhase(`${phase} build`);
        command(root, env, await buildArguments(root));
        recordPhase(`${phase} seed+capture`);
      }
      const stop = await startServer(root, env, path.join(temp, `visual-${phase}-server.log`));
      try {
        if (phase === "head") recordPhase("compare");
        command(root, env, ["npx", ...captureArguments(phase)]);
        const report = JSON.parse(await readFile(env.PLAYWRIGHT_JSON_OUTPUT_NAME, "utf8"));
        if (report.stats?.expected !== 10 || report.stats?.skipped || report.errors?.length || failedScreens(report).length) {
          throw new Error(`${phase}: expected all ten visual screens to pass`);
        }
        if (phase === "base") await validateBaseline(expected);
      } finally {
        recordPhase(`${phase} seed+capture`);
        await stop();
      }
    }
  } finally {
    recordPhase(null);
    const durations = [...timings].map(([phase, ms]) => [phase, ms === null ? "not reached" : `${(ms / 1000).toFixed(1)} s`]);
    const total = ([...timings.values()].reduce((sum, ms) => sum + (ms ?? 0), 0) / 1000).toFixed(1);
    console.log(`Visual Regression timings: ${durations.map(([phase, duration]) => `${phase}=${duration}`).join("; ")}; total=${total} s`);
    const lines = [
      "## Visual Regression phase timings", "",
      "| Phase | Duration |", "| --- | ---: |",
      ...durations.map(([phase, duration]) => `| ${phase} | ${duration} |`), "",
      `Total measured step time: **${total} s**.`, "",
      "Build rows time only `next build`. Seed+capture rows include harness/dependency/DB setup, seeding, server readiness and teardown. Playwright captures and compares head screenshots in one command; that command and report validation are charged to compare, not head seed+capture. Unreached phases are marked rather than reported as zero.", "",
    ];
    await appendFile(process.env.GITHUB_STEP_SUMMARY ?? path.join(workspace, "visual-summary.md"), lines.join("\n"));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
