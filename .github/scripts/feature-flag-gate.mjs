import { execFileSync } from "node:child_process";

// Every UI change ships behind a feature flag, enabled for Owner + QA first
// (Valentin, 2026-09-08). This check is mechanical, driven off the PR title
// tag the pr-title check already enforces:
//   - [BUGFIX], [INFRA] and an auto-revert title ('Revert "..."') pass without
//     a flag, because bug fixes and infra/rollback work ship freely.
//   - Every other tag ([FEATURE] and anything else, e.g. [IMPROVE], [SPEED],
//     [QA], [DASH], [FEEDBACK], [CLI/MCP/AI]) that touches UI files must add
//     or reference a flag from src/lib/flags.ts.
//   - A [BUGFIX]/[INFRA] PR that adds more than 150 lines to UI files fails
//     anyway, so a feature cannot be smuggled in under a bug-fix title.
//
// Same script drives the CI job (feature-flag-gate.yml) and the local
// dry-run against merged PRs, so the calibration never drifts from what
// actually ships.

const NON_FEATURE_TAGS = new Set(["BUGFIX", "INFRA", "CI", "DOCS", "REVERT"]);
const CROSS_CHECK_LINE_BUDGET = 150;

// UI paths: components, non-api pages, the app router tree, and loose
// .tsx/.css outside tests/stories/docs.
const UI_INCLUDE = [
  /^src\/components\//,
  /^src\/pages\/(?!api\/)/,
  /^src\/app\//,
  /\.(tsx|css)$/,
];
const UI_EXCLUDE = [
  /^src\/pages\/api\//,
  /^src\/lib\//, // flags.ts and flags/keys.ts live here; excluded except as a flag reference
  /(^|\/)tests?\//,
  /\.test\.[jt]sx?$/,
  /\.stories\.[jt]sx?$/,
  /(^|\/)docs\//,
  /\.md$/,
];

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isUiFile(path) {
  if (UI_EXCLUDE.some((re) => re.test(path))) return false;
  return UI_INCLUDE.some((re) => re.test(path));
}

// Parses `export const NAME = "value";` pairs out of src/lib/flags/keys.ts at
// a given ref, so a reference check accepts either the exported identifier
// (how UI files actually import flags) or the raw kebab id.
function flagRegistry(ref) {
  let text;
  try {
    text = git(["show", `${ref}:src/lib/flags/keys.ts`]);
  } catch {
    return [];
  }
  const pairs = [];
  const re = /export const (\w+)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) pairs.push({ identifier: m[1], value: m[2] });
  return pairs;
}

function addedLines(diff) {
  const lines = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) lines.push(line.slice(1));
  }
  return lines;
}

export function evaluate({ title, baseSha, headSha }) {
  const changedFiles = git(["diff", "--name-only", `${baseSha}...${headSha}`])
    .split("\n")
    .filter(Boolean);
  const uiFiles = changedFiles.filter(isUiFile);

  if (uiFiles.length === 0) {
    return { pass: true, reason: "No changed file matches the UI-change path filter." };
  }

  const isAutoRevert = /^Revert "/.test(title);
  const tagMatch = title.match(/\[([^\]]+)\]/);
  const tag = tagMatch ? tagMatch[1] : null;
  const exempt = isAutoRevert || (tag && NON_FEATURE_TAGS.has(tag));

  if (exempt) {
    const numstat = git(["diff", "--numstat", `${baseSha}...${headSha}`])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [added, , ...pathParts] = line.split("\t");
        return { added: added === "-" ? 0 : Number(added), path: pathParts.join("\t") };
      });
    const uiAdded = numstat
      .filter((row) => isUiFile(row.path))
      .reduce((sum, row) => sum + row.added, 0);

    if (uiAdded > CROSS_CHECK_LINE_BUDGET) {
      return {
        pass: false,
        reason:
          `This PR is tagged ${isAutoRevert ? "as an auto-revert" : `[${tag}]`} but adds ` +
          `${uiAdded} lines to UI files (over the ${CROSS_CHECK_LINE_BUDGET}-line budget). ` +
          `This looks like a feature, retitle as [FEATURE] and add a flag.`,
      };
    }
    return {
      pass: true,
      reason: `Tag ${isAutoRevert ? "auto-revert" : `[${tag}]`} is exempt (${uiAdded} UI lines added, within budget).`,
    };
  }

  // Not exempt: a flag must be added to, or referenced from, src/lib/flags.ts.
  let flagsDiff = "";
  try {
    flagsDiff = git(["diff", `${baseSha}...${headSha}`, "--", "src/lib/flags.ts"]);
  } catch {
    // file may not exist on one side; treat as no diff
  }
  const addedDefinition = addedLines(flagsDiff).some((line) => /key:\s*(\w+|"[^"]+")/.test(line));
  if (addedDefinition) {
    return { pass: true, reason: `[${tag}] adds a FEATURE_FLAG_DEFINITIONS entry in src/lib/flags.ts.` };
  }

  const registry = flagRegistry(headSha);
  if (registry.length > 0) {
    for (const file of uiFiles) {
      let fileDiff = "";
      try {
        fileDiff = git(["diff", `${baseSha}...${headSha}`, "--", file]);
      } catch {
        continue;
      }
      const added = addedLines(fileDiff);
      const referenced = registry.some(({ identifier, value }) =>
        added.some((line) => line.includes(identifier) || line.includes(value)),
      );
      if (referenced) {
        return { pass: true, reason: `[${tag}] references an existing flag from src/lib/flags/keys.ts in ${file}.` };
      }
    }
  }

  return {
    pass: false,
    reason:
      `[${tag}] touches UI files (${uiFiles.slice(0, 5).join(", ")}${uiFiles.length > 5 ? ", ..." : ""}) ` +
      `without adding or referencing a feature flag. Either:\n` +
      `  (a) add an entry to FEATURE_FLAG_DEFINITIONS in src/lib/flags.ts, or\n` +
      `  (b) import and use an existing flag key from src/lib/flags/keys.ts in a changed UI file, or\n` +
      `  (c) if this is not really a feature, retitle the PR [BUGFIX] or [INFRA].`,
  };
}

// CLI entry point: node feature-flag-gate.mjs <title> <baseSha> <headSha>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [title, baseSha, headSha] = process.argv.slice(2);
  const result = evaluate({ title, baseSha, headSha });
  console.log(result.reason);
  process.exitCode = result.pass ? 0 : 1;
}
