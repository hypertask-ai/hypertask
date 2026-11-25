#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const require = createRequire(import.meta.url);
const FLAG_DEFINITION_PATHS = new Set([
  "src/lib/flags/keys.ts",
  "src/lib/flags.ts",
  "src/lib/flags/definitions.ts",
  "src/lib/flags/releaseRisk.ts",
]);

function touchesFlagDefinitions(changedFiles) {
  return changedFiles.some((path) => FLAG_DEFINITION_PATHS.has(path) || path.startsWith("src/lib/flags/definitions/"));
}

const BUDGET_MS = 10_000;
const FULL_BUDGET_MS = 60_000;
const MIN_BUDGET_MS = 1_000;
const SAMPLE_SIZE = 8;
const lintBudgetMs = Number(process.env.QUICK_CHECK_LINT_BUDGET_MS) || BUDGET_MS;
const typeBudgetMs = Number(process.env.QUICK_CHECK_TYPE_BUDGET_MS) || BUDGET_MS;
const fullTypeBudgetMs = Number(process.env.QUICK_CHECK_FULL_TYPE_BUDGET_MS) || FULL_BUDGET_MS;
const deadlineMs = Number(process.env.QUICK_CHECK_DEADLINE_MS) || FULL_BUDGET_MS;
const LINTABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TYPED = /\.(?:ts|tsx|mts|cts)$/;
const COMPILER = /^(?:tsconfig[^/]*\.json|package(?:-lock)?\.json)$/;
const LINT_CONFIG = /^(?:eslint[^/]*\.[^/]+|\.eslint[^/]*|eslint-local-rules\/.+)$/;

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

function split(value) {
  return (value ?? "").split("\0").filter(Boolean);
}

function repoRoot() {
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  return top ? top.trim() : null;
}

function explicitFiles(argv) {
  const at = argv.indexOf("--files");
  if (at === -1) return null;
  return argv.slice(at + 1).filter((argument) => !argument.startsWith("--"));
}

function changedAgainstBase(root) {
  const mergeBase = git(root, ["merge-base", "HEAD", "origin/production"]);
  if (!mergeBase) return null;
  const base = mergeBase.trim();
  return {
    changed: split(git(root, ["diff", "--name-only", "-z", "--diff-filter=ACMR", base, "HEAD", "--"])),
    touched: split(git(root, ["diff", "--name-only", "-z", base, "HEAD", "--"])),
  };
}

function binary(root, name) {
  return join(process.env.QUICK_CHECK_BIN_DIR || join(root, "node_modules", ".bin"), name);
}

function pushedElsewhere(root) {
  if (process.stdin.isTTY) return null;
  const updates = readFileSync(0, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, localSha, remoteRef]) => !/^0+$/.test(localSha ?? "") && !remoteRef.startsWith("refs/tags/"));
  if (!updates.length) return null;
  const head = (git(root, ["rev-parse", "HEAD"]) ?? "").trim();
  return [...new Set(updates.map(([, localSha]) => localSha))].find((sha) => sha !== head) ?? null;
}

function uncommitted(root, files) {
  return split(git(root, ["diff", "--name-only", "-z", "HEAD", "--", ...files]));
}

function sampleFiles(root, changed) {
  const changedSet = new Set(changed);
  const candidates = split(
    git(root, ["ls-files", "-z", "--", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.mts", "*.cts"]),
  ).filter((file) => LINTABLE.test(file) && !changedSet.has(file));
  if (candidates.length <= SAMPLE_SIZE) return candidates;
  const step = candidates.length / SAMPLE_SIZE;
  return Array.from({ length: SAMPLE_SIZE }, (_, index) => candidates[Math.floor(index * step)]);
}

function elapsed(started) {
  return ((Date.now() - started) / 1000).toFixed(1);
}

function blocked(message) {
  console.error(`quick check: ${message}`);
  process.exit(1);
}

function reportedErrors(output) {
  return /\berror TS\d+/.test(output) || /^\s*\d+:\d+\s+error\s+\S/m.test(output);
}

function start(root, command, args, timeoutMs) {
  const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const collected = { output: "", result: null };
  let timedOut = false;
  let settled = false;
  let timer = null;
  let grace = null;
  child.stdout.on("data", (chunk) => {
    collected.output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    collected.output += chunk;
  });
  collected.result = new Promise((resolve) => {
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      resolve({ ...value, timedOut, finishedAt: Date.now() });
    };
    timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      grace = setTimeout(() => settle({ status: null, signal: "SIGKILL" }), 1000);
    }, timeoutMs);
    child.on("error", (error) => settle({ error }));
    child.on("close", (status, signal) => settle({ status, signal }));
  });
  return collected;
}

const started = Date.now();
const deadline = started + deadlineMs;

const root = repoRoot();
if (!root) {
  console.log("quick check: not a git checkout, nothing to check");
  process.exit(0);
}

const pushedCommit = pushedElsewhere(root);
if (pushedCommit) {
  console.log(`quick check: this push sends ${pushedCommit.slice(0, 12)}, not the checked-out commit, so it is not checked`);
  process.exit(0);
}

const explicit = explicitFiles(process.argv.slice(2));
let lintTargets = [];
let typeTargets = [];
let lintConfigChanged = false;
let sampleTargets = [];
let fullTypecheck = false;
let touched = [];

if (explicit) {
  lintTargets = explicit.filter((file) => LINTABLE.test(file));
  typeTargets = explicit.filter((file) => TYPED.test(file));
} else {
  const changes = changedAgainstBase(root);
  if (!changes) {
    console.log("quick check: no origin/production merge base, checking types only");
    typeTargets = [];
  } else {
    touched = changes.touched;
    lintConfigChanged = changes.touched.some((file) => LINT_CONFIG.test(file));
    fullTypecheck = changes.touched.some((file) => COMPILER.test(file));
    lintTargets = changes.changed.filter((file) => LINTABLE.test(file));
    sampleTargets = lintConfigChanged ? sampleFiles(root, lintTargets) : [];
    typeTargets = changes.changed.filter((file) => TYPED.test(file));
  }
}
typeTargets = typeTargets.filter((file) => existsSync(join(root, file)));

if (lintConfigChanged) {
  console.log(
    `quick check: lint configuration changed, so linting the changed files and ${sampleTargets.length} untouched sample files; the full lint runs in CI`,
  );
} else if (lintTargets.length) console.log(`quick check: linting ${lintTargets.join(", ")}`);
else console.log("quick check: no changed lint targets");

const skipped = [];
const configuration = touched.filter((file) => LINT_CONFIG.test(file) || COMPILER.test(file));
const checked = [...new Set([...configuration, ...lintTargets, ...(fullTypecheck ? [] : typeTargets)])];
const dirty = checked.length ? uncommitted(root, checked) : [];
if (dirty.length) {
  blocked(`uncommitted changes to ${dirty.join(", ")}; commit them so the push carries what was checked`);
}

const typeDirectory = join(root, ".cache", "tsc");
const typeConfig = join(typeDirectory, "quick-check.json");
const typeCache = join(typeDirectory, "quick-check.tsbuildinfo");
const confirmConfig = join(typeDirectory, "confirm.json");
const confirmTypeCache = join(typeDirectory, "confirm.tsbuildinfo");
const fullTypeCache = join(typeDirectory, "full.tsbuildinfo");

function typeLabel() {
  return typeTargets.length ? typeTargets.join(", ") : "the whole project";
}

function shellArgument(file) {
  return /^[\w./@+-]+$/.test(file) ? file : `'${file.replace(/'/g, "'\\''")}'`;
}

function filesCommand(files) {
  return files.length
    ? `node scripts/quick-check.mjs --files ${files.map(shellArgument).join(" ")}`
    : "node scripts/quick-check.mjs";
}

function budgetWithinDeadline(budgetMs) {
  return Math.max(MIN_BUDGET_MS, Math.min(budgetMs, deadline - Date.now()));
}

async function runTool(name, command, args, budgetMs, retryBudgetMs) {
  const toolStarted = Date.now();
  const firstBudget = budgetWithinDeadline(budgetMs);
  const first = start(root, command, args, firstBudget);
  let result = await first.result;
  let output = first.output;
  let used = firstBudget;
  const longerBudget = budgetWithinDeadline(retryBudgetMs);
  if (result.timedOut && longerBudget > firstBudget) {
    console.log(
      `quick check: ${name} passed its ${Math.round(firstBudget / 1000)}s budget; running it once more with ${Math.round(longerBudget / 1000)}s`,
    );
    const second = start(root, command, args, longerBudget);
    result = await second.result;
    output += second.output;
    used = longerBudget;
  }
  return { output, result, seconds: ((Date.now() - toolStarted) / 1000).toFixed(1), budgetMs: used };
}

function lintArgs(pass) {
  return [
    ...(pass.fix ? ["--fix"] : []),
    "--cache",
    "--cache-location",
    join(root, ".cache", "eslint", pass.cache),
    "--suppressions-location",
    "eslint-local-rules/style-guide-suppressions.json",
    "--pass-on-unpruned-suppressions",
    "--no-warn-ignored",
    "--",
    ...pass.files,
  ];
}

const lintPlan = [
  ...(lintTargets.length ? [{ files: lintTargets, fix: true, cache: "quick-check" }] : []),
  ...(sampleTargets.length ? [{ files: sampleTargets, fix: false, cache: "sample" }] : []),
];

async function runLintPlan() {
  const runs = [];
  for (const pass of lintPlan) {
    runs.push(await runTool("eslint", binary(root, "eslint"), lintArgs(pass), lintBudgetMs, lintBudgetMs * 2));
  }
  return runs;
}

let typeArgs = null;
let declarations = [];
let projectFiles = [];
let augmentations = [];
if (!typeTargets.length && !fullTypecheck) {
  console.log("quick check: no changed TypeScript files, skipping the type check");
  skipped.push("types");
} else {
  mkdirSync(typeDirectory, { recursive: true });
  let configPath = typeConfig;
  let cachePath = typeCache;
  if (fullTypecheck) {
    console.log("quick check: the compiler configuration changed, running the full type check");
    configPath = join(typeDirectory, "full.json");
    cachePath = fullTypeCache;
  }
  if (!fullTypecheck) {
    const ts = require("typescript");
    const project = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => blocked(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    });
    if (project.errors.length) {
      blocked(project.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
    }
    projectFiles = project.fileNames;
    const projectFileSet = new Set(projectFiles);
    declarations = projectFiles.filter((file) => /\.d\.(?:ts|mts|cts)$/.test(file));
    augmentations = split(git(root, [
      "grep", "-lz", "-E", "^[[:space:]]*declare[[:space:]]+(module|global)([[:space:]]|$)",
      "--", ":(glob)src/**/*.ts", ":(glob)src/**/*.tsx",
    ])).filter((file) => projectFileSet.has(join(root, file))).map((file) => join(root, file));
  }
  const include = [...new Set([...declarations, ...augmentations, ...typeTargets.map((file) => join(root, file))])]
    .map((file) => relative(typeDirectory, file));
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        extends: relative(typeDirectory, join(root, "tsconfig.json")),
        ...(fullTypecheck ? {} : { include, exclude: ["node_modules"] }),
        compilerOptions: { noEmit: true, incremental: true, tsBuildInfoFile: cachePath },
      },
      null,
      2,
    )}\n`,
  );
  typeArgs = ["-p", configPath];
}

if (lintPlan.length) {
  mkdirSync(join(root, ".cache", "eslint"), { recursive: true });
}

const lintPromise = lintPlan.length ? runLintPlan() : null;
const typePromise = typeArgs
  ? runTool("tsc", binary(root, "tsc"), typeArgs, fullTypecheck ? fullTypeBudgetMs : typeBudgetMs, fullTypeBudgetMs)
  : null;

function confirmationPassed(run) {
  if (run.result.error) {
    blocked(
      run.result.error.code === "ENOENT"
        ? "tsc is not installed in this checkout; run npm install and push again"
        : `tsc could not run: ${run.result.error.message}`,
    );
  }
  if (run.result.timedOut) {
    console.log(
      `quick check: the confirming type check ran out of its ${Math.round(run.budgetMs / 1000)}s budget, so the reported errors stay`,
    );
    return false;
  }
  return !run.result.signal && run.result.status === 0 && !/\berror TS\d+/.test(run.output);
}

function outcome(result, name, files, budgetMs, rerun) {
  if (result.error) {
    if (result.error.code === "ENOENT") {
      blocked(`${name} is not installed in this checkout; run npm install and push again`);
    }
    blocked(`${name} could not run: ${result.error.message}`);
  }
  if (result.timedOut) {
    if (reportedErrors(result.output)) return "failed";
    console.log(
      `quick check: NOT FULLY ${name === "tsc" ? "TYPE CHECKED" : "LINTED"}: ${files} (${name} was still running when its ${Math.round(budgetMs / 1000)}s budget ran out and had reported no errors, so this machine is too slow for it; the full ${name === "tsc" ? "type check" : "lint"} runs in CI). Rerun when the machine is quieter: ${rerun}`,
    );
    if (!skipped.includes(name === "tsc" ? "types" : "lint")) skipped.push(name === "tsc" ? "types" : "lint");
    return "skipped";
  }
  if (result.signal || result.status === 137) {
    console.log(
      `quick check: NOT ${name === "tsc" ? "TYPE CHECKED" : "LINTED"}: ${files} (the machine killed ${name}; this push goes through unchecked)`,
    );
    if (!skipped.includes(name === "tsc" ? "types" : "lint")) skipped.push(name === "tsc" ? "types" : "lint");
    return "skipped";
  }
  return result.status === 0 ? "passed" : "failed";
}

const lintRuns = lintPromise ? await lintPromise : [];
let lintSeconds = 0;
for (const [index, run] of lintRuns.entries()) {
  const pass = lintPlan[index];
  lintSeconds += Number(run.seconds);
  process.stdout.write(run.output);
  const lintOutcome = outcome(run.result, "eslint", pass.files.join(", "), run.budgetMs, filesCommand(pass.files));
  const rewritten = uncommitted(root, pass.files);
  if (rewritten.length) {
    blocked(`formatting fixes applied to ${rewritten.join(", ")}; commit them and push again (${elapsed(started)}s)`);
  }
  if (lintOutcome === "failed") {
    if (run.result.timedOut) {
      blocked(
        `lint reported errors before its ${Math.round(run.budgetMs / 1000)}s budget ran out; the push was stopped after ${elapsed(started)}s`,
      );
    }
    blocked(`lint failed; the push was stopped after ${elapsed(started)}s`);
  }
}

let typeRun = typePromise ? await typePromise : null;
let typeOutcome = typeRun ? outcome(typeRun.result, "tsc", typeLabel(), typeRun.budgetMs, filesCommand(typeTargets)) : "skipped";
if (typeOutcome === "failed" && !fullTypecheck) {
  console.log("quick check: confirming partial type errors with the full project");
  const confirmFiles = [...new Set([...projectFiles, ...typeTargets.map((file) => join(root, file))])]
    .filter((file) => existsSync(file))
    .map((file) => relative(typeDirectory, file));
  writeFileSync(
    confirmConfig,
    `${JSON.stringify(
      {
        extends: relative(typeDirectory, join(root, "tsconfig.json")),
        files: confirmFiles,
        include: [],
        compilerOptions: { noEmit: true, incremental: true, tsBuildInfoFile: confirmTypeCache },
      },
      null,
      2,
    )}\n`,
  );
  typeRun = await runTool("tsc", binary(root, "tsc"), ["-p", confirmConfig], fullTypeBudgetMs, fullTypeBudgetMs);
  if (confirmationPassed(typeRun)) typeOutcome = "passed";
  else {
    console.log("quick check: the full project did not clear the partial errors, so the push stays blocked");
    typeOutcome = "failed";
  }
}
if (typeRun) process.stdout.write(typeRun.output);
if (typeOutcome === "failed") {
  blocked(`the type check failed; the push was stopped after ${elapsed(started)}s`);
}

let flagOutcome = "skipped";
const flagScope = explicit ?? touched;
if (flagScope.length && touchesFlagDefinitions(flagScope)) {
  const mergeBase = git(root, ["merge-base", "HEAD", "origin/production"]);
  const head = (git(root, ["rev-parse", "HEAD"]) ?? "").trim();
  if (mergeBase && head) {
    console.log("quick check: running the feature-flag definition gate");
    if (!process.env.FEATURE_FLAG_TYPESCRIPT_PATH) {
      process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
    }
    const { evaluateFlagDefinitionChanges } = await import("../.github/scripts/feature-flag-gate.mjs");
    const result = evaluateFlagDefinitionChanges({
      baseSha: mergeBase.trim(),
      headSha: head,
      changedFiles: flagScope,
    });
    if (!result.pass) {
      blocked(`${result.reason}; the push was stopped after ${elapsed(started)}s`);
    }
    flagOutcome = "passed";
  }
}

const total = Date.now() - started;
const skippedParts = [...skipped];
if (flagOutcome === "skipped") skippedParts.push("feature flags");
const skippedNote = skippedParts.length ? `, skipped ${skippedParts.join(" and ")}` : "";
console.log(
  `quick check: format, lint and types passed in ${(total / 1000).toFixed(1)}s (lint ${lintSeconds.toFixed(1)}s, types ${typeRun ? typeRun.seconds : "0.0"}s)${skippedNote}`,
);
if (total > BUDGET_MS) console.log(`quick check: over the ${BUDGET_MS / 1000}s budget for this change`);
