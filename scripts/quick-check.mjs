#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const BUDGET_MS = 10_000;
const FULL_LINT_BUDGET_MS = 60_000;
const typeBudgetMs = Number(process.env.QUICK_CHECK_TYPE_BUDGET_MS) || BUDGET_MS;
const LINTABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TYPED = /\.(?:ts|tsx|mts|cts)$/;
const CONFIG = /^(?:eslint[^/]*\.[^/]+|\.eslint[^/]*|eslint-local-rules\/|package(?:-lock)?\.json$|tsconfig[^/]*\.json$)/;

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
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
  const split = (value) => (value ?? "").split("\0").filter(Boolean);
  return {
    changed: split(git(root, ["diff", "--name-only", "-z", "--diff-filter=ACMR", base, "HEAD", "--"])),
    touched: split(git(root, ["diff", "--name-only", "-z", base, "HEAD", "--"])),
  };
}

function binary(root, name) {
  const local = join(root, "node_modules", ".bin", name);
  return existsSync(local) ? local : name;
}

function dirtyFiles(root) {
  const out = git(root, ["diff", "--name-only", "-z", "--"]) ?? "";
  return new Set(out.split("\0").filter(Boolean));
}

function elapsed(started) {
  return ((Date.now() - started) / 1000).toFixed(1);
}

function blocked(message) {
  console.error(`quick check: ${message}`);
  process.exit(1);
}

function start(root, command, args, timeoutMs) {
  const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const collected = { output: "", result: null };
  let timedOut = false;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs)
    : null;
  child.stdout.on("data", (chunk) => {
    collected.output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    collected.output += chunk;
  });
  collected.result = new Promise((resolve) => {
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ error, finishedAt: Date.now() });
    });
    child.on("close", (status, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ status, signal, timedOut, finishedAt: Date.now() });
    });
  });
  return collected;
}

const started = Date.now();

if (process.env.HYPERTASK_SKIP_QUICK_CHECK) {
  console.log("quick check: skipped (HYPERTASK_SKIP_QUICK_CHECK is set)");
  process.exit(0);
}

const root = repoRoot();
if (!root) {
  console.log("quick check: not a git checkout, nothing to check");
  process.exit(0);
}

let targets = explicitFiles(process.argv.slice(2));
let fullLint = false;
if (targets) {
  targets = targets.filter((file) => LINTABLE.test(file));
} else {
  const changes = changedAgainstBase(root);
  if (!changes) {
    console.log("quick check: no origin/production merge base, checking types only");
    targets = [];
  } else {
    fullLint = changes.touched.some((file) => CONFIG.test(file));
    targets = fullLint ? [] : changes.changed.filter((file) => LINTABLE.test(file));
  }
}

if (fullLint) console.log("quick check: lint configuration changed, running the full lint");
else if (targets.length) console.log(`quick check: ${targets.length} changed file(s): ${targets.join(", ")}`);
else console.log("quick check: no changed JavaScript or TypeScript files");

const skipped = [];
const before = targets.length && !fullLint ? dirtyFiles(root) : new Set();

let lintRun = null;
const lintStarted = Date.now();
if (fullLint || targets.length) {
  const cacheDirectory = join(root, ".cache", "eslint");
  mkdirSync(cacheDirectory, { recursive: true });
  lintRun = start(root, binary(root, "eslint"), [
    ...(fullLint ? [] : ["--fix"]),
    "--cache",
    "--cache-location",
    join(cacheDirectory, "quick-check"),
    "--suppressions-location",
    "eslint-local-rules/style-guide-suppressions.json",
    "--pass-on-unpruned-suppressions",
    "--no-warn-ignored",
    "--",
    ...(fullLint ? ["."] : targets),
  ], fullLint ? FULL_LINT_BUDGET_MS : BUDGET_MS);
}

const typeDirectory = join(root, ".cache", "tsc");
const typeConfig = join(typeDirectory, "quick-check.json");
const typeCache = join(typeDirectory, "quick-check.tsbuildinfo");
const typed = targets.filter((file) => TYPED.test(file) && existsSync(join(root, file)));
let typeRun = null;
const typeStarted = Date.now();
if (!typed.length) {
  console.log("quick check: no changed TypeScript files, skipping the type check");
  skipped.push("types");
} else {
  mkdirSync(typeDirectory, { recursive: true });
  const include = [...typed, ...(existsSync(join(root, "next-env.d.ts")) ? ["next-env.d.ts"] : [])].map((file) =>
    relative(typeDirectory, join(root, file)),
  );
  writeFileSync(
    typeConfig,
    `${JSON.stringify(
      {
        extends: relative(typeDirectory, join(root, "tsconfig.json")),
        include,
        exclude: ["node_modules"],
        compilerOptions: { noEmit: true, incremental: true, tsBuildInfoFile: typeCache },
      },
      null,
      2,
    )}\n`,
  );
  if (!existsSync(typeCache)) console.log("quick check: warming the type-check cache, so this run is slower");
  typeRun = start(root, binary(root, "tsc"), ["-p", typeConfig], typeBudgetMs);
}

const lintResult = lintRun ? await lintRun.result : null;
if (lintRun) process.stdout.write(lintRun.output);
const typeResult = typeRun ? await typeRun.result : null;
if (typeRun) process.stdout.write(typeRun.output);
const lintSeconds = lintResult ? ((lintResult.finishedAt - lintStarted) / 1000).toFixed(1) : "0.0";
const typeSeconds = typeResult ? ((typeResult.finishedAt - typeStarted) / 1000).toFixed(1) : "0.0";

if (lintResult) {
  if (lintResult.error) {
    if (lintResult.error.code === "ENOENT")
      console.log("quick check: eslint is not installed in this checkout (npm install), skipping lint");
    else blocked(`eslint could not run: ${lintResult.error.message}`);
  } else if (lintResult.signal || lintResult.status === 137) {
    skipped.push("lint");
    console.log(
      lintResult.timedOut
        ? "quick check: eslint passed its time budget, so this push skips the lint gate"
        : "quick check: eslint was killed, so this push skips the lint gate",
    );
  }
}

const rewritten = targets.length && !fullLint ? [...dirtyFiles(root)].filter((file) => !before.has(file)) : [];
if (rewritten.length) {
  blocked(`formatting fixes applied to ${rewritten.join(", ")}; commit them and push again (${elapsed(started)}s)`);
}

if (lintResult && !lintResult.error && lintResult.status !== 0 && !lintResult.signal) {
  blocked(`lint failed; the push was stopped after ${elapsed(started)}s`);
}

if (typeResult) {
  if (typeResult.error) {
    if (typeResult.error.code === "ENOENT")
      console.log("quick check: tsc is not installed in this checkout (npm install), skipping the type check");
    else blocked(`the type check could not run: ${typeResult.error.message}`);
  } else if (typeResult.signal || typeResult.status === 137) {
    skipped.push("types");
    console.log(
      typeResult.timedOut
        ? `quick check: the type check passed its ${typeBudgetMs / 1000}s budget, so this push skips it`
        : "quick check: tsc was killed, so this push skips the type gate",
    );
  } else if (typeResult.status !== 0) {
    blocked(`the type check failed; the push was stopped after ${elapsed(started)}s`);
  }
}

const total = Date.now() - started;
const skippedNote = skipped.length ? `, skipped ${skipped.join(" and ")}` : "";
console.log(
  `quick check: format, lint and types passed in ${(total / 1000).toFixed(1)}s (lint ${lintSeconds}s, types ${typeSeconds}s)${skippedNote}`,
);
if (total > BUDGET_MS) console.log(`quick check: over the ${BUDGET_MS / 1000}s budget for this change`);
