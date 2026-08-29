// HTPR-5652 — stops a pull request from going green by rewriting its own baselines.
//
// The visual gate only means something if the reference images are harder to
// change than the code they check. Without this, any PR could run
// `harness.mjs update`, commit the new pixels, and the gate would approve the
// regression it exists to catch.
//
// The rule: touching visual/baseline/** requires the PR body to declare the
// change under a `## Visual change` heading, so a reviewer knows to compare the
// new screenshots against the approved wireframe. Same shape as revert-guard's
// intentional-revert label: deliberate visual changes stay easy, silent ones
// become impossible.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const BASELINE_PREFIX = "visual/baseline/";

// A real markdown heading only. "see the ## Visual change section" inside a
// sentence must not satisfy the gate.
const VISUAL_CHANGE_HEADING = /^[ \t]{0,3}#{1,6}[ \t]+visual change(s|d)?\b/im;

export function declaresVisualChange(prBody) {
  return VISUAL_CHANGE_HEADING.test(String(prBody ?? ""));
}

export function evaluateBaselineChange({ changedFiles = [], prBody = "" } = {}) {
  const baselineFiles = changedFiles
    .map((file) => String(file).trim())
    .filter((file) => file.startsWith(BASELINE_PREFIX));

  if (baselineFiles.length === 0) {
    return { ok: true, baselineFiles, reason: "no baseline files changed" };
  }
  if (declaresVisualChange(prBody)) {
    return { ok: true, baselineFiles, reason: "the pull request declares the visual change" };
  }
  return {
    ok: false,
    baselineFiles,
    reason: "baseline images changed without a `## Visual change` section in the pull request body",
  };
}

// In CI the workflow hands over the API's file list, which is resolved against
// the real merge base. Everything else is a local convenience path.
export function readChangedFilesFile(file) {
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

function changedFilesFromGit(baseRef, headSha) {
  // Local fallback only. Two dots, not three: a shallow clone has no common
  // ancestor, so `A...B` would abort with "no merge base". This is also why CI
  // does not use this path - against a moving base tip it reports files the
  // branch never touched (every baseline PNG, on any branch that forked before
  // they landed) and the guard would fail unrelated pull requests.
  const output = execFileSync("git", ["diff", "--name-only", baseRef, headSha], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\n").filter(Boolean);
}

function main() {
  const changedFilesFile = process.env.CHANGED_FILES_FILE;
  let changedFiles;
  if (changedFilesFile) {
    changedFiles = readChangedFilesFile(changedFilesFile);
  } else {
    const baseRef = process.env.BASE_SHA || process.env.GITHUB_BASE_REF;
    const headSha = process.env.HEAD_SHA || "HEAD";
    if (!baseRef) throw new Error("CHANGED_FILES_FILE, BASE_SHA or GITHUB_BASE_REF is required");
    changedFiles = changedFilesFromGit(baseRef, headSha);
  }

  const result = evaluateBaselineChange({
    changedFiles,
    prBody: process.env.PR_BODY || "",
  });

  if (result.ok) {
    console.log(`Visual baseline guard passed: ${result.reason}.`);
    return;
  }

  console.error("Visual baseline guard failed:\n");
  for (const file of result.baselineFiles) console.error(`  ${file}`);
  console.error(
    "\nThis pull request changes the reference screenshots the visual gate compares against, so the gate can no longer detect the change it makes.\n" +
      "If the visual change is intended, add a `## Visual change` section to the pull request body describing what moved and why, so a reviewer checks the new screenshots against the approved design. Otherwise revert visual/baseline/ and rerun.",
  );
  process.exitCode = 1;
}

// Importable for tests; only the direct invocation runs the git-backed check.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    console.error(`Visual baseline guard error: ${error.message}`);
    process.exitCode = 2;
  }
}
