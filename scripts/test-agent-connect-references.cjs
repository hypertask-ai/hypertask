const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const base = git("merge-base", "origin/production", "HEAD");
const changed = [...new Set([...git("diff", "--name-only", base).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")])].filter((file) => file && file !== "GATES.md" && fs.existsSync(path.join(root, file)));
const needles = changed.flatMap((file) => [file, file.replace(/\.tsx?$/, ""), file.replace(/^src\//, "@/").replace(/\.tsx?$/, "")]);
const files = git("ls-files", "tests").split("\n").filter((file) => /\.test\.(cjs|ts)$/.test(file) && needles.some((needle) => fs.readFileSync(path.join(root, file), "utf8").includes(needle)));
assert.ok(files.length > 0, "No referencing tests discovered");
const hash = crypto.createHash("sha256").update(process.version).update(base);
for (const file of [...new Set([...changed, ...git("ls-files", "src", "tests", "package-lock.json").split("\n")])].sort()) {
  if (fs.existsSync(path.join(root, file))) hash.update(file).update(fs.readFileSync(path.join(root, file)));
}
const state = path.join(root, ".unlazy/htpr-7026/referencing-tests", hash.digest("hex"));
fs.mkdirSync(state, { recursive: true, mode: 0o700 });
console.log(`Changed-file referencing tests: ${files.length}, sequential workers. Evidence: ${path.relative(root, state)}`);
const failed = [];
for (const file of files) {
  const record = path.join(state, `${path.basename(file)}.json`);
  if (fs.existsSync(record) && JSON.parse(fs.readFileSync(record, "utf8")).status === 0) continue;
  const args = file.endsWith(".cjs") ? ["--test", "--test-reporter=tap", file] : ["node_modules/tsx/dist/cli.mjs", file];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  fs.writeFileSync(`${record}.log`, output, { mode: 0o600 });
  fs.writeFileSync(record, JSON.stringify({ file, status: result.status, error: result.error?.message, tests: output.match(/^# tests (\d+)/m)?.[1], node: process.version }), { mode: 0o600 });
  if (result.status !== 0 || result.error) {
    failed.push(file);
    console.error(`FAIL ${file}: ${result.error?.message ?? `exit ${result.status}`}. Full output: ${path.relative(root, record)}.log`);
    for (const line of output.split("\n")) {
      if (/^not ok |^\s*(error:|message:|code:|actual:|expected:|location:)|^# (tests|pass|fail) /.test(line)) console.error(line);
    }
  }
}
assert.deepEqual(failed, [], "Referencing test failures");
console.log(`Referencing tests passed: ${files.length} files, with successful results bound to exact source, tests, lockfile and Node version.`);
