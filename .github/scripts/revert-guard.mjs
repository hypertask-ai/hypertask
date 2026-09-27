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
function ghLines(endpoint, query) {
  const output = execFileSync("gh", ["api", "--paginate", endpoint, "--jq", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
function intentionalRevertApproval(head) {
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = process.env.PR_NUMBER;
  const liveHead = execFileSync("gh", ["api", `repos/${repo}/pulls/${pr}`, "--jq", ".head.sha"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (liveHead !== head) throw new Error("PR head changed during revert-guard check");

  const events = ghLines(`repos/${repo}/issues/${pr}/events?per_page=100`,
    '.[] | select(.label.name == "intentional-revert" and (.event == "labeled" or .event == "unlabeled")) | {id, event, created_at, actor: .actor.login, actor_type: .actor.type, app: .performed_via_github_app}');
  if (events.some((event) => !Number.isFinite(Date.parse(event.created_at)) || !Number.isSafeInteger(event.id))) {
    throw new Error("intentional-revert event history has no reliable ordering");
  }
  const latest = events.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id).at(-1);
  if (!latest || latest.event !== "labeled") return { event: latest };

  const suites = ghLines(`repos/${repo}/commits/${head}/check-suites?per_page=100`,
    '.check_suites[] | {head_sha, created_at}');
  const timeline = ghLines(`repos/${repo}/issues/${pr}/timeline?per_page=100`,
    '.[] | select(.event == "committed" or .event == "head_ref_force_pushed") | {event, commit_id, after, created_at}');
  const suiteDates = suites.filter((suite) => suite.head_sha === head).map((suite) => Date.parse(suite.created_at));
  const pushDates = timeline.filter((item) => item.commit_id === head || item.after === head)
    .map((item) => Date.parse(item.created_at));
  if ([...suiteDates, ...pushDates].some((date) => !Number.isFinite(date))) return { event: latest, arrival: null };
  // Later check suites include the labeled run itself; only the first suite
  // approximates head arrival. A later push event supersedes that estimate.
  const arrivals = [...(suiteDates.length ? [Math.min(...suiteDates)] : []), ...pushDates];
  return { event: latest, arrival: arrivals.length ? Math.max(...arrivals) : null };
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
  if (/^Binary files .* differ$/m.test(diff)) throw new Error("diff contains an uninspectable binary change");
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
  const expectedHead = process.env.PR_HEAD_SHA;
  const actualHead = git(["rev-parse", "HEAD"]).trim();
  if (expectedHead && expectedHead !== actualHead) {
    throw new Error(`checkout is ${actualHead}, expected PR head ${expectedHead}`);
  }
  if (hasLabel("intentional-revert")) {
    const { event, arrival } = intentionalRevertApproval(actualHead);
    const actor = event?.actor || "unknown (no matching labeled event)";
    const approvers = (process.env.HUMAN_APPROVERS ?? "valentinyeo")
      .split(",").map((login) => login.trim().toLowerCase());
    if (process.env.PR_HEAD_IS_FORK === "true" || event?.event !== "labeled" || event?.actor_type !== "User" ||
        event?.app !== null || !approvers.includes(actor.toLowerCase()) ||
        !Number.isFinite(Date.parse(event.created_at)) || arrival === null || Date.parse(event.created_at) <= arrival) {
      console.error(`Revert Guard failed: intentional-revert requires a direct HUMAN_APPROVERS label after this head and the last removal (actor: ${actor}).`);
      process.exitCode = 1;
      return;
    }
    console.log("Revert Guard skipped: PR has a fresh intentional-revert approval.");
    return;
  }

  const baseRef = `origin/${process.env.GITHUB_BASE_REF || "staging"}`;
  const mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
  const diff = git(["-c", "core.quotePath=false", "diff", "--text", "--no-ext-diff", "--no-textconv",
    "--unified=0", "--no-color", mergeBase, "HEAD", "--"]);
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
