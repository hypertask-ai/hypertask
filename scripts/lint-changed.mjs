import { spawnSync } from "node:child_process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Cannot determine changed files.");
  return result.stdout;
}

const base = git(["merge-base", "HEAD", "origin/production"]).trim();
const changed = [...new Set([
  ...git(["diff", "--name-only", "-z", "--diff-filter=ACMR", base, "--"]).split("\0"),
  ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
].filter(Boolean))];
// Include deleted config files: those can also change lint outside the PR.
const configurationChanges = [...changed, ...git(["diff", "--name-only", "-z", base, "--"]).split("\0")];
// Config, rules and dependency changes can affect files outside the PR.
const full = configurationChanges.some(file => /^(eslint[^/]*\.[^/]+|\.eslint[^/]*|eslint-local-rules\/|package(?:-lock)?\.json$|tsconfig[^/]*\.json$)/.test(file));
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
