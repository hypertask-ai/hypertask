import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BUGFIX_TITLE = /^(?:HTPR|HYFA|YPER4|HYCI)-\d+ \[BUGFIX\] \S/;
const TEST_FILE = /\.test\.(?:cjs|ts|mjs)$/;
const REPLAYABLE_TEST = /^tests\/.*\.test\.(?:cjs|ts)$/;
const SHA = /^[0-9a-f]{40}$/;
const FILE_TIMEOUT_MS = Number(process.env.BUGFIX_REGRESSION_TEST_TIMEOUT_MS ?? 120_000);

export function isBugfixTitle(title) {
  return BUGFIX_TITLE.test(title ?? "");
}

export function labelNames(labels) {
  return (labels ?? []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
}

function acceptableReason(raw) {
  const reason = String(raw ?? "").trim().replace(/^`+|`+$/g, "").trim();
  if (!reason || reason === "..." || !/[A-Za-z]/.test(reason) || reason.length < 8) return "";
  return reason.slice(0, 200);
}

function stripHtmlComments(input) {
  let text = String(input ?? "");
  let previous;
  do {
    previous = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
  } while (text !== previous);
  return text;
}

export function exemptionReason(labels, body) {
  if (!labelNames(labels).includes("no-regression-test")) return "";
  const text = stripHtmlComments(body);
  const found = [];
  for (const pattern of [
    /No new automated test applies because:\s*`([^`\n]*)`/gi,
    /No new automated test applies because:\s*([^\n]+)/gi,
    /^[ \t>*-]*no-regression-test:\s*([^\n]+)/gim,
  ]) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found.map(acceptableReason).find(Boolean) ?? "";
}

export function parseNameStatus(text) {
  const parts = String(text).split("\0").filter((part) => part.length > 0);
  const rows = [];
  for (let index = 0; index < parts.length; index += 1) {
    const status = parts[index];
    if (status.startsWith("R") || status.startsWith("C")) {
      rows.push({ status: status[0], path: parts[index + 2] });
      index += 2;
    } else {
      rows.push({ status: status[0], path: parts[index + 1] });
      index += 1;
    }
  }
  return rows.filter((row) => row.path);
}

function safeRepoPath(file) {
  return Boolean(file) && !file.startsWith("/") && !file.split("/").includes("..");
}

export function selectChangedTests(rows) {
  return rows
    .filter((row) => row.status !== "D" && safeRepoPath(row.path) && TEST_FILE.test(row.path))
    .map((row) => row.path);
}

export function replayTests(files) {
  return files.filter((file) => REPLAYABLE_TEST.test(file));
}

function overlayPaths(rows) {
  return rows
    .filter((row) => row.status !== "D" && safeRepoPath(row.path) && row.path.startsWith("tests/"))
    .map((row) => row.path);
}

export function decideRun({ title, body = "", labels = [] }) {
  if (!isBugfixTitle(title)) {
    return { status: "skip", lines: ["bugfix-regression skip not a bugfix pull request"] };
  }
  const reason = exemptionReason(labels, body);
  if (reason) return { status: "exempt", lines: [`bugfix-regression exempt ${reason}`] };
  return { status: "run", lines: [] };
}

export function classifyPullRequest({ title, body = "", labels = [], testFiles = [] }) {
  const decided = decideRun({ title, body, labels });
  if (decided.status !== "run") return decided;
  if (testFiles.length === 0) {
    return { status: "flag", lines: ["bugfix-regression flag no test file added or changed"] };
  }
  if (replayTests(testFiles).length === 0) {
    return { status: "flag", lines: [`bugfix-regression flag ${testFiles[0]} is outside tests/, so the replay cannot run it`] };
  }
  return { status: "run", lines: [] };
}

export function judgeResults(outcomes) {
  const lines = [];
  for (const outcome of outcomes) {
    if (outcome.head !== "pass") {
      lines.push(`bugfix-regression flag ${outcome.file} fails on the pull request head`);
    } else if (outcome.base === "error") {
      lines.push(`bugfix-regression flag ${outcome.file} base setup failed; reproduction is unproven`);
    } else if (outcome.base === "pass") {
      lines.push(`bugfix-regression flag ${outcome.file} passes on the merge base, so it does not reproduce the bug`);
    }
  }
  if (lines.length === 0) {
    return { status: "pass", lines: outcomes.map((outcome) => `bugfix-regression pass ${outcome.file}`) };
  }
  return { status: "flag", lines };
}

export function failureLine(output) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines.find((line) => line.startsWith("not ok"));
  const diff = lines.find((line) => line.includes("!==") || line.includes("AssertionError") || line.startsWith("Error:"));
  const picked = [name, diff].filter(Boolean).join(" | ");
  return (picked || lines.at(-1) || "no output").replace(/\s+/g, " ").slice(0, 240);
}

function git(repo, args, encoding) {
  return spawnSync("git", args, {
    cwd: repo,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function requireSha(sha, label) {
  if (!SHA.test(sha ?? "")) throw new Error(`${label} is not a commit sha`);
  return sha;
}

function resolveHead(repo, head) {
  if (head) return requireSha(head, "head");
  const result = git(repo, ["rev-parse", "HEAD"], "utf8");
  if (result.status !== 0) throw new Error(result.stderr || "git rev-parse failed");
  return requireSha(result.stdout.trim(), "head");
}

function resolveBase(repo, base, head) {
  const target = base ? requireSha(base, "base") : "origin/production";
  const result = git(repo, ["merge-base", head, target], "utf8");
  if (result.status !== 0) throw new Error((result.stderr || "merge-base failed").toString().trim());
  return requireSha(result.stdout.trim(), "base");
}

function changedRows(repo, base, head) {
  const result = git(repo, ["diff", "--name-status", "--find-renames", "-z", base, head]);
  if (result.status !== 0) throw new Error((result.stderr || "git diff failed").toString().trim());
  return parseNameStatus(result.stdout.toString("utf8"));
}

function createWorktree(repo, sha) {
  const parent = mkdtempSync(path.join(tmpdir(), "bugfix-regression-"));
  const dir = path.join(parent, "wt");
  const result = git(repo, ["worktree", "add", "--detach", dir, sha], "utf8");
  if (result.status !== 0) {
    rmSync(parent, { recursive: true, force: true });
    throw new Error((result.stderr || "git worktree add failed").trim());
  }
  return dir;
}

function removeWorktree(repo, dir) {
  if (!dir) return;
  git(repo, ["worktree", "remove", "--force", dir], "utf8");
  rmSync(path.dirname(dir), { recursive: true, force: true });
}

function linkModules(modules, dir) {
  const source = path.join(modules, "node_modules");
  const target = path.join(dir, "node_modules");
  if (existsSync(source) && !existsSync(target)) symlinkSync(source, target, "dir");
}

function overlayFiles(repo, sha, dir, files) {
  for (const file of files) {
    const shown = git(repo, ["show", `${sha}:${file}`]);
    if (shown.status !== 0) continue;
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, shown.stdout);
  }
}

function generateFlags(dir) {
  const script = path.join(dir, "scripts/generate-flag-index.mjs");
  if (!existsSync(script)) return;
  spawnSync(process.execPath, [script], { cwd: dir, timeout: 60_000, env: childEnv() });
}

function schemaBytes(dir) {
  const chunks = [];
  for (const relative of ["prisma.config.ts", "prisma/schema.prisma", "src/prisma/schema.prisma"]) {
    const file = path.join(dir, relative);
    if (existsSync(file)) chunks.push(readFileSync(file));
  }
  return Buffer.concat(chunks);
}

function childEnv() {
  const env = { ...process.env, NODE_OPTIONS: "", TEST_FILE_TIMEOUT_MS: String(FILE_TIMEOUT_MS), CI: "true" };
  for (const key of ["NODE_TEST_CONTEXT", "NODE_CHANNEL_FD", "NODE_TEST_NO_ASYNC_HOOK"]) delete env[key];
  return env;
}

function runTestFile(dir, file) {
  const runner = path.join(dir, "scripts/run-tests.mjs");
  const args = existsSync(runner)
    ? [runner, file]
    : ["--test", `--test-timeout=${FILE_TIMEOUT_MS}`, file];
  const result = spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: "utf8",
    timeout: FILE_TIMEOUT_MS + 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: childEnv(),
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
  return {
    passed: result.status === 0 && !result.signal && !result.error,
    setupFailed: Boolean(result.error || result.signal || !/ERR_ASSERTION|AssertionError/.test(output) || /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|SyntaxError:|Cannot find (?:module|package)/.test(output)),
    output,
  };
}

function detailLine(detail, side) {
  const state = detail[side];
  const extra = detail[`${side}Line`];
  return `bugfix-regression detail ${detail.file} ${side} ${state}${extra ? `: ${extra}` : ""}`;
}

export function report(result) {
  const lines = [...result.lines];
  for (const detail of result.details ?? []) {
    lines.push(detailLine(detail, "base"));
    lines.push(detailLine(detail, "head"));
  }
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  if (process.env.GITHUB_ACTIONS) {
    for (const line of result.lines) {
      if (line.startsWith("bugfix-regression flag")) console.log(`::warning::${line}`);
    }
  }
  return lines;
}

function writeOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value).replace(/\n/g, " ")}\n`);
}

export function runCheck({ repo, title, body = "", labels = [], base, head, modules }) {
  const resolvedHead = resolveHead(repo, head);
  const resolvedBase = resolveBase(repo, base, resolvedHead);
  const rows = changedRows(repo, resolvedBase, resolvedHead);
  const classified = classifyPullRequest({
    title,
    body,
    labels,
    testFiles: selectChangedTests(rows),
  });
  if (classified.status !== "run") return { ...classified, details: [], base: resolvedBase, head: resolvedHead };

  const testFiles = replayTests(selectChangedTests(rows));
  const baseDir = createWorktree(repo, resolvedBase);
  let headDir;
  try {
    headDir = createWorktree(repo, resolvedHead);
    const moduleRoot = modules || repo;
    linkModules(moduleRoot, baseDir);
    linkModules(moduleRoot, headDir);
    overlayFiles(repo, resolvedHead, baseDir, overlayPaths(rows));
    for (const file of ["package.json", "package-lock.json"]) {
      const before = path.join(baseDir, file);
      const after = path.join(headDir, file);
      if (existsSync(before) !== existsSync(after) || (existsSync(before) && !readFileSync(before).equals(readFileSync(after)))) {
        return { status: "error", lines: ["bugfix-regression error Dependencies differ; reproduction requires separate dependency installs"], details: [], base: resolvedBase, head: resolvedHead };
      }
    }
    generateFlags(baseDir);
    generateFlags(headDir);
    if (!schemaBytes(baseDir).equals(schemaBytes(headDir))) {
      return { status: "error", lines: ["bugfix-regression error Prisma schemas differ; reproduction requires separate dependency installs"], details: [], base: resolvedBase, head: resolvedHead };
    }
    const outcomes = [];
    const details = [];
    const headRuns = new Map();
    for (const file of testFiles) headRuns.set(file, runTestFile(headDir, file));
    for (const file of testFiles) {
      const headRun = headRuns.get(file);
      const baseRun = headRun.passed ? runTestFile(baseDir, file) : null;
      outcomes.push({
        file,
        head: headRun.passed ? "pass" : "fail",
        base: baseRun?.passed ? "pass" : baseRun?.setupFailed ? "error" : "fail",
      });
      details.push({
        file,
        head: headRun.passed ? "pass" : "fail",
        base: baseRun ? (baseRun.passed ? "pass" : baseRun.setupFailed ? "error" : "fail") : "not-run",
        headLine: headRun.passed ? "" : failureLine(headRun.output),
        baseLine: baseRun && !baseRun.passed ? failureLine(baseRun.output) : "",
      });
    }
    return { ...judgeResults(outcomes), details, base: resolvedBase, head: resolvedHead };
  } finally {
    removeWorktree(repo, baseDir);
    removeWorktree(repo, headDir);
  }
}

function arg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return undefined;
  return argv[index + 1];
}

function repeated(argv, name) {
  const values = [];
  argv.forEach((token, index) => {
    if (token === name && argv[index + 1]) values.push(argv[index + 1]);
  });
  return values;
}

function readEvent() {
  if (!process.env.GITHUB_EVENT_PATH) return null;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const pullRequest = event.pull_request;
  if (!pullRequest) return null;
  return {
    title: pullRequest.title ?? "",
    body: pullRequest.body ?? "",
    labels: pullRequest.labels ?? [],
    base: pullRequest.base?.sha,
    head: pullRequest.head?.sha,
  };
}

function readPullRequest(argv) {
  const title = arg(argv, "--title");
  const labels = repeated(argv, "--label");
  if (title) {
    const bodyFile = arg(argv, "--body-file");
    return {
      title,
      body: bodyFile ? readFileSync(bodyFile, "utf8") : (arg(argv, "--body") ?? ""),
      labels,
      base: arg(argv, "--base"),
      head: arg(argv, "--head"),
      repo: arg(argv, "--repo") || process.cwd(),
      modules: arg(argv, "--modules") || arg(argv, "--repo") || process.cwd(),
    };
  }
  if (process.env.PR_TITLE) {
    return {
      title: process.env.PR_TITLE,
      body: process.env.PR_BODY ?? "",
      labels: JSON.parse(process.env.PR_LABELS || "[]"),
      base: process.env.BASE_SHA || undefined,
      head: process.env.HEAD_SHA || undefined,
      repo: process.env.BUGFIX_REGRESSION_REPO || process.cwd(),
      modules: process.env.BUGFIX_REGRESSION_MODULES || process.env.BUGFIX_REGRESSION_REPO || process.cwd(),
    };
  }
  const event = readEvent();
  if (!event) throw new Error("no pull request title was provided");
  return {
    ...event,
    base: process.env.BASE_SHA || event.base,
    head: process.env.HEAD_SHA || event.head,
    repo: process.cwd(),
    modules: process.cwd(),
  };
}

function ghJson(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || "gh failed").trim());
  return JSON.parse(result.stdout);
}

function gitOk(repo, args) {
  const result = git(repo, args, "utf8");
  if (result.status !== 0) throw new Error((result.stderr || `git ${args[0]} failed`).trim());
  return result.stdout;
}

export function backtest({ repo, limit, modules }) {
  gitOk(repo, ["fetch", "--no-tags", "origin", "production"]);
  const listed = ghJson([
    "pr", "list", "--repo", "hypertask-ai/hypertask", "--base", "production", "--state", "merged",
    "--limit", "80", "--search", "BUGFIX in:title", "--json", "number,title,mergedAt",
  ]);
  const pulls = listed.sort((left, right) => right.mergedAt.localeCompare(left.mergedAt)).slice(0, limit);
  const results = [];
  for (const pull of pulls) {
    process.stderr.write(`bugfix-regression checking ${pull.number}\n`);
    const view = ghJson([
      "pr", "view", String(pull.number), "--repo", "hypertask-ai/hypertask",
      "--json", "title,body,labels,headRefOid,mergeCommit",
    ]);
    gitOk(repo, ["fetch", "--no-tags", "origin", `pull/${pull.number}/head`]);
    const head = gitOk(repo, ["rev-parse", "FETCH_HEAD"]).trim();
    let result;
    try {
      const merge = requireSha(view.mergeCommit?.oid, "historical merge");
      const base = gitOk(repo, ["rev-parse", `${merge}^1`]).trim();
      result = runCheck({
        repo,
        modules,
        base,
        title: view.title,
        body: view.body ?? "",
        labels: (view.labels ?? []).map((label) => label.name),
        head,
      });
    } catch (error) {
      result = { status: "error", lines: [`bugfix-regression error ${error.message}`], details: [] };
    }
    report(result);
    results.push({ number: pull.number, title: view.title, status: result.status, lines: result.lines });
  }
  const pass = results.filter((result) => result.status === "pass").length;
  const flag = results.filter((result) => result.status === "flag").length;
  const other = results.length - pass - flag;
  console.log(`bugfix-regression summary total=${results.length} pass=${pass} flag=${flag} other=${other}`);
  for (const result of results) {
    console.log(`bugfix-regression pr ${result.number} ${result.status} ${result.lines[0] ?? ""}`);
  }
  return results;
}

function main() {
  const argv = process.argv.slice(2);
  try {
    if (argv.includes("--backtest")) {
      const limit = Number(arg(argv, "--backtest") ?? 20);
      backtest({
        repo: arg(argv, "--repo") || process.cwd(),
        modules: arg(argv, "--modules") || arg(argv, "--repo") || process.cwd(),
        limit: Number.isInteger(limit) && limit > 0 ? limit : 20,
      });
      return;
    }
    const pullRequest = readPullRequest(argv);
    if (argv.includes("--decide")) {
      const result = decideRun(pullRequest);
      const willRun = result.status === "run";
      writeOutput("run", willRun ? "true" : "false");
      if (!willRun) report({ ...result, details: [] });
      return;
    }
    if (argv.includes("--diff-only")) {
      const head = resolveHead(pullRequest.repo, pullRequest.head);
      const base = resolveBase(pullRequest.repo, pullRequest.base, head);
      const testFiles = selectChangedTests(changedRows(pullRequest.repo, base, head));
      const result = classifyPullRequest({ ...pullRequest, testFiles });
      writeOutput("tests", result.status === "run" ? "true" : "false");
      writeOutput("base", base);
      if (result.status !== "run") report({ ...result, details: [] });
      else for (const file of replayTests(testFiles)) console.log(`bugfix-regression test ${file}`);
      return;
    }
    report(runCheck(pullRequest));
  } catch (error) {
    console.log(`bugfix-regression error ${error instanceof Error ? error.message : String(error)}`);
    writeOutput("run", "false");
    writeOutput("tests", "false");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
