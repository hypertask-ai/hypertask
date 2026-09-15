#!/usr/bin/env node
/**
 * design-gate: publishes the `design-gate` commit status for open production
 * pull requests.
 *
 * Runs from a trusted production checkout, mirroring feature-flag-gate's
 * `trusted_script_source: production_base_commit`. It runs production's copy of
 * scripts/design-lint.mjs and production's copy of docs/design/lint-allow.txt
 * against the pull request's diff, so a pull request cannot pass itself by
 * editing the linter or its own allowlist.
 *
 * It reads diff text only. It never executes pull-request code.
 *
 * Usage: node .github/scripts/design-gate.mjs <pr-number> [<pr-number> ...]
 * Exit codes: 0 every pull request was evaluated and published, 2 otherwise.
 */

import { execFileSync, spawnSync } from "node:child_process";

const REPO = process.env.REPO;
const RUN_URL = process.env.RUN_URL ?? "";
const CONTEXT = "design-gate";
const MARKER = "<!-- design-gate -->";

if (!REPO) {
  console.error("::error::REPO is not set.");
  process.exit(2);
}

function gh(args, input) {
  const res = spawnSync("gh", args, {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${(res.stderr || "").trim()}`);
  }
  return res.stdout;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function hasCommit(sha) {
  const res = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { encoding: "utf8" });
  return res.status === 0;
}

function publishStatus(sha, state, description) {
  const payload = JSON.stringify({
    state,
    context: CONTEXT,
    description: description.slice(0, 130),
    target_url: RUN_URL,
  });
  gh(["api", "-X", "POST", `repos/${REPO}/statuses/${sha}`, "--input", "-"], payload);
}

function commentBody(findings) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  const lines = [
    MARKER,
    `### design-gate: ${findings.length} style violation${findings.length === 1 ? "" : "s"} on changed lines`,
    "",
    "The rules are [`docs/design/STYLE-GUIDE.md`](../blob/production/docs/design/STYLE-GUIDE.md); `openwiki/style-guide.md` stays canonical.",
    "Only lines this pull request added are checked, so nothing here is historical drift.",
    "",
  ];
  for (const [file, group] of byFile) {
    lines.push(`**\`${file}\`**`, "");
    for (const f of group.slice(0, 20)) {
      lines.push(`- L${f.line} \`${f.rule}\`: ${f.message}`);
      lines.push(`  - ${f.fix}`);
    }
    if (group.length > 20) lines.push(`- …and ${group.length - 20} more in this file.`);
    lines.push("");
  }
  lines.push(
    "Run `node scripts/design-lint.mjs` locally to reproduce.",
    "An owner-approved exception goes in `docs/design/lint-allow.txt` with its ticket, on a separate pull request."
  );
  return lines.join("\n");
}

function upsertComment(prNumber, body) {
  let existing = [];
  try {
    existing = JSON.parse(
      gh(["api", "--paginate", `repos/${REPO}/issues/${prNumber}/comments?per_page=100`])
    );
  } catch {
    existing = [];
  }
  const mine = existing.find((c) => (c.body ?? "").startsWith(MARKER));
  const payload = JSON.stringify({ body });
  if (mine) {
    gh(["api", "-X", "PATCH", `repos/${REPO}/issues/comments/${mine.id}`, "--input", "-"], payload);
  } else {
    gh(["api", "-X", "POST", `repos/${REPO}/issues/${prNumber}/comments`, "--input", "-"], payload);
  }
}

function clearComment(prNumber) {
  let existing = [];
  try {
    existing = JSON.parse(
      gh(["api", "--paginate", `repos/${REPO}/issues/${prNumber}/comments?per_page=100`])
    );
  } catch {
    return;
  }
  const mine = existing.find((c) => (c.body ?? "").startsWith(MARKER));
  if (!mine) return;
  gh(
    ["api", "-X", "PATCH", `repos/${REPO}/issues/comments/${mine.id}`, "--input", "-"],
    JSON.stringify({ body: `${MARKER}\n### design-gate: clear\n\nNo style violations on the changed lines.` })
  );
}

function evaluate(prNumber) {
  const pr = JSON.parse(gh(["api", `repos/${REPO}/pulls/${prNumber}`]));
  if (pr.state !== "open" || pr.base?.ref !== "production") {
    console.log(`#${prNumber}: not an open production pull request, skipping.`);
    return true;
  }
  const baseSha = pr.base.sha;
  const headSha = pr.head.sha;
  if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(headSha)) {
    console.error(`::error::#${prNumber} has incomplete commit metadata.`);
    return false;
  }

  publishStatus(headSha, "pending", "design-gate is checking the changed lines");

  // The checkout is a full clone of production, so the base commit is normally
  // already present. Never pass --depth here: it would turn that full clone
  // shallow and truncate the history the diff needs.
  try {
    git(["fetch", "--no-tags", "origin", `refs/pull/${prNumber}/head`]);
  } catch (err) {
    console.error(`::error::#${prNumber}: cannot fetch the head commit: ${err.message}`);
    publishStatus(headSha, "error", "design-gate could not fetch this pull request");
    return false;
  }
  if (!hasCommit(headSha) || !hasCommit(baseSha)) {
    try {
      git(["fetch", "--no-tags", "origin", "production"]);
    } catch {
      /* the check below reports the real problem */
    }
  }
  if (!hasCommit(headSha) || !hasCommit(baseSha)) {
    console.error(`::error::#${prNumber}: the pull request commits are unavailable.`);
    publishStatus(headSha, "error", "design-gate could not reach this pull request's commits");
    return false;
  }

  const run = spawnSync(
    "node",
    ["scripts/design-lint.mjs", "--base", baseSha, "--head", headSha, "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );

  if (run.status === 2 || run.status === null) {
    console.error(`::error::#${prNumber}: design-lint could not evaluate the diff.`);
    console.error(run.stderr);
    publishStatus(headSha, "error", "design-gate could not evaluate this pull request");
    return false;
  }

  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    console.error(`::error::#${prNumber}: design-lint returned unreadable output.`);
    publishStatus(headSha, "error", "design-gate could not read its own result");
    return false;
  }

  // The head may have moved while we were linting. Publishing a stale result
  // would gate the wrong commit, so let the queued event handle the new one.
  const current = JSON.parse(gh(["api", `repos/${REPO}/pulls/${prNumber}`]));
  if (current.head?.sha !== headSha || current.state !== "open") {
    console.log(`#${prNumber}: head moved during evaluation; a later event will re-check.`);
    return true;
  }

  const count = result.findings.length;
  if (count === 0) {
    const checked = result.filesChecked.length;
    publishStatus(
      headSha,
      "success",
      checked
        ? `No style violations on the changed lines of ${checked} UI file(s)`
        : "No linted UI files changed"
    );
    clearComment(prNumber);
    console.log(`#${prNumber}: pass (${checked} UI file(s) checked).`);
    return true;
  }

  publishStatus(headSha, "failure", `${count} style violation(s) on changed lines`);
  try {
    upsertComment(prNumber, commentBody(result.findings));
  } catch (err) {
    console.log(`::warning::#${prNumber}: could not post the findings comment: ${err.message}`);
  }
  console.log(`#${prNumber}: ${count} violation(s).`);
  for (const f of result.findings.slice(0, 40)) {
    console.log(`  ${f.file}:${f.line} [${f.rule}] ${f.message}`);
  }
  return true;
}

const numbers = process.argv.slice(2).filter((n) => /^\d+$/.test(n));
if (!numbers.length) {
  console.error("::error::design-gate needs at least one pull-request number.");
  process.exit(2);
}

let failures = 0;
for (const n of numbers) {
  try {
    if (!evaluate(n)) failures += 1;
  } catch (err) {
    console.error(`::error::#${n}: ${err.message}`);
    failures += 1;
  }
}
process.exit(failures ? 2 : 0);
