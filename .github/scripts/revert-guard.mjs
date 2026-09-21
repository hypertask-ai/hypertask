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
  return /^[ab]\//.test(value) ? value.slice(2) : value;
}
function changedLines(diff) {
  const removed = [];
  const added = [];
  let file = null;
  let newFile = null;
  let oldLine = null;
  let addedFile = false;
  let hunk = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = null;
      newFile = null;
      oldLine = null;
      addedFile = false;
    } else if (line.startsWith("--- ")) {
      file = decodePath(line.slice(4));
      addedFile = file === null;
    } else if (line.startsWith("+++ ")) {
      newFile = decodePath(line.slice(4));
    } else if (line.startsWith("@@ ")) {
      hunk += 1;
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : null;
    } else if (file && oldLine !== null && line.startsWith("-")) {
      if (!LOCKFILES.has(file.split("/").at(-1))) {
        removed.push({ file, hunk, line: oldLine, text: line.slice(1) });
      }
      oldLine += 1;
    } else if (newFile && line.startsWith("+") && !line.startsWith("+++")) {
      added.push({ file: newFile, hunk, isNewFile: addedFile, text: line.slice(1) });
    } else if (oldLine !== null && line.startsWith(" ")) {
      oldLine += 1;
    }
  }
  return { removed, added };
}

function normalizedCodeLine(text) {
  return text.replace(/\s+/g, "");
}

function normalizedExtractedCode(text) {
  return normalizedCodeLine(text).replace(/[;,]/g, "");
}

function excludeExtractedLines(removed, added) {
  const sourceByFile = new Map();
  for (const { file, isNewFile, text } of added) {
    if (!isNewFile) continue;
    const normalized = normalizedExtractedCode(text);
    sourceByFile.set(file, `${sourceByFile.get(file) || ""}${normalized}`);
  }
  const occurrenceCounts = new Map();

  return removed.filter((line) => {
    const normalized = normalizedExtractedCode(line.text);
    if (normalized.length === 0) return true;
    let count = occurrenceCounts.get(normalized);
    if (count === undefined) {
      count = [...sourceByFile.values()].reduce((total, source) => {
        let found = 0;
        let offset = 0;
        while ((offset = source.indexOf(normalized, offset)) !== -1) {
          found += 1;
          offset += normalized.length;
        }
        return total + found;
      }, 0);
    }
    occurrenceCounts.set(normalized, count);
    if (count === 0) return true;
    occurrenceCounts.set(normalized, count - 1);
    return false;
  });
}

function excludeReformattedLines(removed, added) {
  const additionsByFile = new Map();
  for (const line of added) {
    const normalized = normalizedExtractedCode(line.text);
    additionsByFile.set(
      line.file,
      `${additionsByFile.get(line.file) || ""}${normalized}`,
    );
  }
  const occurrenceCounts = new Map();

  return removed.filter((line) => {
    const normalized = normalizedExtractedCode(line.text);
    if (normalized.length === 0) return true;
    const key = `${line.file}\0${normalized}`;
    let count = occurrenceCounts.get(key);
    if (count === undefined) {
      const source = additionsByFile.get(line.file) || "";
      count = source.split(normalized).length - 1;
    }
    occurrenceCounts.set(key, count);
    if (count === 0) return true;
    occurrenceCounts.set(key, count - 1);
    return false;
  });
}

function lineSimilarity(left, right) {
  const a = normalizedCodeLine(left);
  const b = normalizedCodeLine(right);
  if (a.length < 8 || b.length < 8) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function isSourceLoaderReplacement(removed, added) {
  const loader = removed.match(/^\s*const\s+(\w+)\s*=\s*fs\.readFileSync\(\s*$/);
  if (loader) {
    const name = loader[1];
    return new RegExp(`^\\s*const\\s+${name}\\s*=\\s*(?:read\\w+Source\\(\\)|\\[)`).test(added);
  }
  const sourcePath = /^\s*["']src\/.*\.[cm]?[jt]sx?["'],?\s*$/;
  return sourcePath.test(removed) && sourcePath.test(added);
}

function excludeEditedTestLines(removed, added) {
  const additionsByHunk = new Map();
  for (const line of added) {
    const key = `${line.file}\0${line.hunk}`;
    const rows = additionsByHunk.get(key) || [];
    rows.push(line.text);
    additionsByHunk.set(key, rows);
  }

  return removed.filter((line) => {
    if (!/(^|\/)(?:tests?|e2e)\//.test(line.file)) return true;
    const candidates = additionsByHunk.get(`${line.file}\0${line.hunk}`) || [];
    let bestIndex = -1;
    let bestSimilarity = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      if (isSourceLoaderReplacement(line.text, candidates[index])) {
        bestIndex = index;
        bestSimilarity = 1;
        break;
      }
      const similarity = lineSimilarity(line.text, candidates[index]);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = index;
      }
    }
    if (bestSimilarity < 0.8) return true;
    candidates.splice(bestIndex, 1);
    return false;
  });
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

  const baseRef = process.env.REVERT_GUARD_BASE_REF ||
    `origin/${process.env.GITHUB_BASE_REF || "staging"}`;
  const mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
  const diff = git(["-c", "core.quotePath=false", "diff", mergeBase, "HEAD",
    "--unified=0", "--no-color", "--no-ext-diff", "--"]);
  const changed = changedLines(diff);
  const extracted = excludeExtractedLines(changed.removed, changed.added);
  const reformatted = excludeReformattedLines(extracted, changed.added);
  const removed = excludeEditedTestLines(reformatted, changed.added);
  if (!removed.length) {
    console.log("Revert Guard passed: this PR removes no lines that were not extracted to new files.");
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
