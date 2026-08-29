import { execFileSync, spawnSync } from "node:child_process";

const DAY = 86_400;
const RECENT_SECONDS = 14 * DAY;
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]);
function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
}
function hasLabel(name) {
  try {
    return JSON.parse(process.env.PR_LABELS || "[]").some(
      (label) => (label.name || label).toLowerCase() === name,
    );
  } catch {
    throw new Error("PR_LABELS is not valid JSON");
  }
}
function decodePath(value) {
  // git terminates the ---/+++ name with a tab when the path contains a space,
  // so an unstripped tab makes `git blame -- <path>` fail with "no such path".
  if (value.endsWith("\t")) value = value.slice(0, -1);
  if (value === "/dev/null") return null;
  if (value.startsWith('"')) value = JSON.parse(value);
  return value.startsWith("a/") ? value.slice(2) : value;
}
function removedLines(diff) {
  const removed = [];
  let file = null;
  let oldLine = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = null;
      oldLine = null;
    } else if (line.startsWith("--- ")) {
      file = decodePath(line.slice(4));
    } else if (line.startsWith("@@ ")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : null;
    } else if (file && oldLine !== null && line.startsWith("-")) {
      if (!LOCKFILES.has(file.split("/").at(-1))) {
        removed.push({ file, line: oldLine, text: line.slice(1) });
      }
      oldLine += 1;
    } else if (oldLine !== null && line.startsWith(" ")) {
      oldLine += 1;
    }
  }
  return removed;
}
function rangesFor(lines) {
  const ranges = [];
  for (const item of lines) {
    const last = ranges.at(-1);
    if (last && last.file === item.file && item.line === last.end + 1) last.end = item.line;
    else {
      ranges.push({ file: item.file, start: item.line, end: item.line });
    }
  }
  return ranges;
}

function blameRange(range, mergeBase) {
  const output = git(["blame", "-w", "--line-porcelain", "-L",
    `${range.start},${range.end}`, mergeBase, "--", range.file]);
  const blamed = [];
  let sha = null;
  for (const line of output.split("\n")) {
    const header = line.match(/^\^?([0-9a-f]{40}) \d+ \d+/);
    if (header) sha = header[1];
    if (sha && line.startsWith("\t")) blamed.push({ sha, text: line.slice(1) });
  }
  return blamed;
}

function isNonTrivial(line) {
  return !/^\s*[{}()[\],;]*\s*$/.test(line);
}

function main() {
  if (hasLabel("intentional-revert")) {
    console.log("Revert Guard skipped: PR has the intentional-revert label.");
    return;
  }

  const expectedHead = process.env.PR_HEAD_SHA;
  const actualHead = git(["rev-parse", "HEAD"]).trim();
  if (expectedHead && expectedHead !== actualHead) {
    throw new Error(`checkout is ${actualHead}, expected PR head ${expectedHead}`);
  }

  const baseRef = `origin/${process.env.GITHUB_BASE_REF || "staging"}`;
  const mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
  const diff = git(["-c", "core.quotePath=false", "diff", mergeBase, "HEAD",
    "--unified=0", "--no-color", "--no-ext-diff", "--"]);
  const removed = removedLines(diff);
  if (!removed.length) {
    console.log("Revert Guard passed: this PR removes no lines.");
    return;
  }

  const byCommit = new Map();
  for (const range of rangesFor(removed)) {
    for (const line of blameRange(range, mergeBase)) {
      const entry = byCommit.get(line.sha) || [];
      entry.push({ file: range.file, text: line.text });
      byCommit.set(line.sha, entry);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const flagged = [];
  for (const [sha, lines] of byCommit) {
    const reachable = spawnSync("git", ["merge-base", "--is-ancestor", sha, baseRef]).status === 0;
    if (!reachable || lines.filter((line) => isNonTrivial(line.text)).length < 3) continue;

    const metadata = git(["show", "-s", "--format=%at%x00%an%x00%s", sha]);
    const [stamp, author, subject] = metadata.trimEnd().split("\0");
    const ageSeconds = now - Number(stamp);
    if (ageSeconds > RECENT_SECONDS) continue;
    // Repo-bootstrap commits (the open-source squash and snapshot mirrors)
    // make ALL code look 0 days old; they are not anyone's recent work.
    if (/^(Initial open-source release|Mirror staging @)/.test(subject)) continue;

    const files = new Map();
    for (const line of lines) files.set(line.file, (files.get(line.file) || 0) + 1);
    flagged.push({ sha, author, subject, age: Math.max(0, Math.floor(ageSeconds / DAY)), files });
  }

  if (!flagged.length) {
    console.log("Revert Guard passed: no recent staging work was removed.");
    return;
  }

  console.error("Revert Guard failed:\n");
  for (const commit of flagged.sort((a, b) => a.age - b.age)) {
    console.error(`${commit.sha.slice(0, 7)} ${commit.subject}`);
    console.error(`  Author: ${commit.author}; age: ${commit.age} day(s)`);
    for (const [file, count] of [...commit.files].sort()) {
      console.error(`  ${file}: ${count} deleted line(s)`);
    }
    console.error("");
  }
  console.error("This PR deletes code that landed on staging in the last 14 days. If intentional, add the `intentional-revert` label and re-run. Otherwise rebase onto origin/staging and re-apply your change on top of the current file.");
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Revert Guard error: ${error.message}`);
  process.exitCode = 2;
}
