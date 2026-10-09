const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const base = git("merge-base", "origin/production", "HEAD");
const changed = [...new Set([...git("diff", "--name-only", base).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")])].filter((file) => file && fs.existsSync(path.join(root, file)));
const needles = changed.flatMap((file) => [file, file.replace(/\.tsx?$/, ""), file.replace(/^src\//, "@/").replace(/\.tsx?$/, "")]);
const files = git("ls-files", "tests").split("\n").filter((file) => /\.test\.(cjs|ts)$/.test(file) && needles.some((needle) => fs.readFileSync(path.join(root, file), "utf8").includes(needle)));
assert.ok(files.length > 0, "No referencing tests discovered");
console.log(`Changed-source referencing tests: ${files.length}\n${files.join("\n")}`);
const cjs = files.filter((file) => file.endsWith(".cjs"));
const groups = [["--test", "--test-concurrency=1", ...cjs], ...files.filter((file) => file.endsWith(".ts")).map((file) => ["node_modules/tsx/dist/cli.mjs", file])];
for (const args of groups) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) process.stderr.write((result.stdout ?? "") + (result.stderr ?? ""));
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Referencing test failure: ${args.join(" ")}`);
  const summary = (result.stdout ?? "").match(/^# (?:tests|pass|fail) .*$/gm) ?? [];
  console.log(summary.join("\n") || `${args.at(-1)} passed`);
}
console.log(`Referencing tests passed: ${files.length} files, sequential workers.`);
