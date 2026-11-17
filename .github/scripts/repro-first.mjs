import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isBugfixTitle, parseNameStatus, replayTests, runCheck, selectChangedTests } from "./bugfix-regression-check.mjs";

const SHA = /^[0-9a-f]{40}$/;

export function judgeReproFirst({ title, srcChanged, check }) {
  if (!isBugfixTitle(title)) {
    return { status: "skip", code: 0, lines: ["repro-first skip not a bugfix pull request"] };
  }
  if (!srcChanged) {
    return { status: "exempt", code: 0, lines: ["repro-first exempt no source file changed"] };
  }
  if (check?.status === "error") {
    return { status: "fail", code: 1, lines: ["repro-first fail the old code could not be checked", ...(check.lines ?? [])] };
  }
  const details = check?.details ?? [];
  const brokenHead = details.filter((detail) => detail.head !== "pass");
  if (brokenHead.length > 0) {
    return {
      status: "fail",
      code: 1,
      lines: brokenHead.map((detail) => `repro-first fail ${detail.file} does not pass on the pull request`),
    };
  }
  const reproduced = details.filter((detail) => detail.base === "fail");
  if (reproduced.length === 0) {
    return { status: "fail", code: 1, lines: ["repro-first fail no changed test fails on the old code"] };
  }
  return {
    status: "pass",
    code: 0,
    lines: reproduced.map((detail) => `repro-first pass ${detail.file} fails on the old code and passes on the pull request`),
  };
}

function gitText(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || `git ${args[0]} failed`).trim());
  return result.stdout;
}

function pair(repo, base, head) {
  const resolvedHead = (head || gitText(repo, ["rev-parse", "HEAD"])).trim();
  if (!SHA.test(resolvedHead)) throw new Error("head is not a commit sha");
  const resolvedBase = gitText(repo, ["merge-base", resolvedHead, base || "origin/production"]).trim();
  if (!SHA.test(resolvedBase)) throw new Error("base is not a commit sha");
  return { head: resolvedHead, base: resolvedBase };
}

export function changedSource(repo, base, head) {
  return gitText(repo, ["diff", "--name-only", "-z", base, head, "--", "src"]).split("\0").filter(Boolean);
}

export function changedReplayTests(repo, base, head) {
  const rows = parseNameStatus(gitText(repo, ["diff", "--name-status", "--find-renames", "-z", base, head]));
  return replayTests(selectChangedTests(rows));
}

function emit(verdict) {
  for (const line of verdict.lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verdict.lines.join("\n")}\n`);
  return verdict.code;
}

function writeOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readRequest(argv) {
  return {
    repo: option(argv, "--repo") || process.env.BUGFIX_REGRESSION_REPO || process.cwd(),
    title: option(argv, "--title") || process.env.PR_TITLE || "",
    base: option(argv, "--base") || process.env.BASE_SHA || undefined,
    head: option(argv, "--head") || process.env.HEAD_SHA || undefined,
  };
}

export function evaluate({ repo, title, base, head, scopeOnly }) {
  const judgedSkip = judgeReproFirst({ title, srcChanged: true, check: { details: [] } });
  if (judgedSkip.status === "skip") return { ...judgedSkip, run: false };
  const resolved = pair(repo, base, head);
  const sources = changedSource(repo, resolved.base, resolved.head);
  if (sources.length === 0) return { ...judgeReproFirst({ title, srcChanged: false }), run: false };
  const tests = changedReplayTests(repo, resolved.base, resolved.head);
  if (tests.length === 0 || scopeOnly) {
    if (tests.length === 0) return { ...judgeReproFirst({ title, srcChanged: true, check: { details: [] } }), run: false };
    return { status: "run", code: 0, run: true, lines: tests.map((file) => `repro-first run ${file}`) };
  }
  const check = runCheck({
    repo,
    modules: repo,
    title,
    body: "",
    labels: [],
    base: resolved.base,
    head: resolved.head,
  });
  return { ...judgeReproFirst({ title, srcChanged: true, check }), run: false };
}

function main() {
  const argv = process.argv.slice(2);
  try {
    const request = readRequest(argv);
    const verdict = evaluate({ ...request, scopeOnly: argv.includes("--scope") });
    writeOutput("run", verdict.run ? "true" : "false");
    process.exitCode = emit(verdict);
  } catch (error) {
    const line = `repro-first fail ${error instanceof Error ? error.message : String(error)}`;
    console.log(line);
    writeOutput("run", "false");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
