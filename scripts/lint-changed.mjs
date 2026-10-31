import { spawnSync } from "node:child_process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Cannot determine changed files.");
  return result.stdout;
}

const base = process.argv[2] ?? "origin/production";
let from = "";
try {
  from = git(["merge-base", "HEAD", base]).trim();
} catch {
  from = "";
}

if (!from) {
  console.log(`Cannot resolve a merge base with ${base}; running full lint.`);
  const result = spawnSync("eslint", [
    "--suppressions-location", "eslint-local-rules/style-guide-suppressions.json",
    "--pass-on-unpruned-suppressions", ".",
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const changed = [...new Set([
  ...git(["diff", "--name-only", "-z", "--diff-filter=ACMR", from, "--"]).split("\0"),
  ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
].filter(Boolean))];
const configurationChanges = [...changed, ...git(["diff", "--name-only", "-z", from, "--"]).split("\0")];
const full = configurationChanges.some(file => /^(eslint[^/]*\.[^/]+|\.eslint[^/]*|eslint-local-rules\/|\.oxlintrc\.json$|package(?:-lock)?\.json$|tsconfig[^/]*\.json$)/.test(file));
const files = full ? ["."] : changed.filter(file => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file));
if (!files.length) {
  console.log("No changed JavaScript or TypeScript files to lint.");
} else {
  console.log(full ? "Lint configuration changed; running full lint." : `Linting ${files.length} changed files.`);
  const result = spawnSync("eslint", [
    "--suppressions-location", "eslint-local-rules/style-guide-suppressions.json",
    "--pass-on-unpruned-suppressions", "--no-warn-ignored", "--", ...files,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
