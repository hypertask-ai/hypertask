#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const BUDGET_MS = 10_000;
const FULL_BUDGET_MS = 60_000;
const typeBudgetMs = Number(process.env.QUICK_CHECK_TYPE_BUDGET_MS) || BUDGET_MS;
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
  const local = join(root, "node_modules", ".bin", name);
  return existsSync(local) ? local : name;
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

function elapsed(started) {
  return ((Date.now() - started) / 1000).toFixed(1);
}

function blocked(message) {
  console.error(`quick check: ${message}`);
  process.exit(1);
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

if (process.env.HYPERTASK_SKIP_QUICK_CHECK) {
  console.log("quick check: skipped (HYPERTASK_SKIP_QUICK_CHECK is set)");
  process.exit(0);
}

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
let fullLint = false;
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
    fullLint = changes.touched.some((file) => LINT_CONFIG.test(file));
    fullTypecheck = changes.touched.some((file) => COMPILER.test(file));
    lintTargets = fullLint ? [] : changes.changed.filter((file) => LINTABLE.test(file));
    typeTargets = changes.changed.filter((file) => TYPED.test(file));
  }
}
typeTargets = typeTargets.filter((file) => existsSync(join(root, file)));

if (fullLint) console.log("quick check: lint configuration changed, running the full lint");
else if (lintTargets.length) console.log(`quick check: linting ${lintTargets.join(", ")}`);
else console.log("quick check: no changed lint targets");

const skipped = [];
const configuration = touched.filter((file) => LINT_CONFIG.test(file) || COMPILER.test(file));
const checked = [...new Set([...configuration, ...lintTargets, ...(fullTypecheck ? [] : typeTargets)])];
const dirty = checked.length ? uncommitted(root, checked) : [];
if (dirty.length) {
  blocked(`uncommitted changes to ${dirty.join(", ")}; commit them so the push carries what was checked`);
}

let lintRun = null;
const lintStarted = Date.now();
if (fullLint || lintTargets.length) {
  const cacheDirectory = join(root, ".cache", "eslint");
  mkdirSync(cacheDirectory, { recursive: true });
  lintRun = start(
    root,
    binary(root, "eslint"),
    [
      ...(fullLint ? [] : ["--fix"]),
      "--cache",
      "--cache-location",
      join(cacheDirectory, "quick-check"),
      "--suppressions-location",
      "eslint-local-rules/style-guide-suppressions.json",
      "--pass-on-unpruned-suppressions",
      "--no-warn-ignored",
      "--",
      ...(fullLint ? ["."] : lintTargets),
    ],
    fullLint ? FULL_BUDGET_MS : BUDGET_MS,
  );
}

const typeDirectory = join(root, ".cache", "tsc");
const typeConfig = join(typeDirectory, "quick-check.json");
const typeCache = join(typeDirectory, "quick-check.tsbuildinfo");
const fullTypeCache = join(typeDirectory, "full.tsbuildinfo");
let typeRun = null;
const typeStarted = Date.now();
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
  const include = [
    ...(existsSync(join(root, "next-env.d.ts")) ? ["next-env.d.ts"] : []),
    ...typeTargets,
  ].map((file) => relative(typeDirectory, join(root, file)));
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
  typeRun = start(root, binary(root, "tsc"), ["-p", configPath], fullTypecheck ? FULL_BUDGET_MS : typeBudgetMs);
}

const lintResult = lintRun ? await lintRun.result : null;
const lintSeconds = lintResult ? ((lintResult.finishedAt - lintStarted) / 1000).toFixed(1) : "0.0";
if (lintRun) process.stdout.write(lintRun.output);
const typeResult = typeRun ? await typeRun.result : null;
const typeSeconds = typeResult ? ((typeResult.finishedAt - typeStarted) / 1000).toFixed(1) : "0.0";
if (typeRun) process.stdout.write(typeRun.output);

function outcome(result, name) {
  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.log(`quick check: ${name} is not installed in this checkout (npm install), skipping it`);
      return "skipped";
    }
    blocked(`${name} could not run: ${result.error.message}`);
  }
  if (result.signal || result.status === 137) {
    skipped.push(name === "eslint" ? "lint" : "types");
    console.log(
      result.timedOut
        ? `quick check: ${name} passed its time budget, so this push skips it`
        : `quick check: ${name} was killed, so this push skips it`,
    );
    return "skipped";
  }
  return result.status === 0 ? "passed" : "failed";
}

const lintOutcome = lintResult ? outcome(lintResult, "eslint") : "skipped";
const rewritten = lintTargets.length ? uncommitted(root, lintTargets) : [];
if (lintOutcome === "failed") {
  if (rewritten.length) {
    blocked(`formatting fixes applied to ${rewritten.join(", ")}; commit them and push again (${elapsed(started)}s)`);
  }
  blocked(`lint failed; the push was stopped after ${elapsed(started)}s`);
}
if (rewritten.length) {
  blocked(`formatting fixes applied to ${rewritten.join(", ")}; commit them and push again (${elapsed(started)}s)`);
}

const typeOutcome = typeResult ? outcome(typeResult, "tsc") : "skipped";
if (typeOutcome === "failed") {
  blocked(`the type check failed; the push was stopped after ${elapsed(started)}s`);
}

const total = Date.now() - started;
const skippedNote = skipped.length ? `, skipped ${skipped.join(" and ")}` : "";
console.log(
  `quick check: format, lint and types passed in ${(total / 1000).toFixed(1)}s (lint ${lintSeconds}s, types ${typeSeconds}s)${skippedNote}`,
);
if (total > BUDGET_MS) console.log(`quick check: over the ${BUDGET_MS / 1000}s budget for this change`);
