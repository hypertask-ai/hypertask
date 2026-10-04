const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const base = execFileSync("git", ["merge-base", "HEAD", "origin/production"], { cwd: root, encoding: "utf8" }).trim();
const changed = new Set([
  ...execFileSync("git", ["diff", "--name-only", base], { cwd: root, encoding: "utf8" }).trim().split("\n"),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split("\n"),
].filter((name) => /\.(?:ts|tsx|cjs)$/.test(name) && !name.startsWith(".slack-")));

const result = spawnSync("npx", ["tsc", "--noEmit", "-p", "."], { cwd: root, encoding: "utf8", timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
assert.ifError(result.error);
const output = result.stdout + result.stderr;
const diagnostics = [...output.matchAll(/^(.+?)\(\d+,\d+\): error TS(\d+): ([\s\S]*?)(?=^.+?\(\d+,\d+\): error TS\d+: |$(?![\s\S]))/gm)];
// Incremental noEmit can use either TypeScript diagnostic exit status.
assert.ok(result.status === 0 || ([1, 2].includes(result.status) && diagnostics.length > 0), "tsc must run to completion");
assert.ok(diagnostics.every((match) => !changed.has(match[1])), "changed TypeScript has diagnostics:\n" + diagnostics.filter((match) => changed.has(match[1])).map((match) => match[0]).join("\n"));
if (result.status !== 0) {
  // Read baseline sources through a compiler host, without changing any worktree files.
  const config = ts.getParsedCommandLineOfConfigFile(path.join(root, "tsconfig.json"), {}, ts.sys);
  assert.ok(config && config.errors.length === 0);
  const tracked = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", base], { cwd: root, encoding: "utf8" }).trim().split("\n"));
  const replacements = new Map();
  for (const file of changed) {
    if (tracked.has(file) && /\.tsx?$/.test(file)) replacements.set(path.join(root, file), execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8" }));
  }
  const options = { ...config.options, incremental: false };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile;
  host.readFile = (filename) => replacements.has(path.resolve(filename)) ? replacements.get(path.resolve(filename)) : readFile(filename);
  const baselineFiles = config.fileNames.filter((filename) => {
    const relative = path.relative(root, filename);
    return !changed.has(relative) || tracked.has(relative);
  });
  const program = ts.createProgram(baselineFiles, options, host);
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const baseline = new Set(ts.getPreEmitDiagnostics(program).map((diagnostic) => `${diagnostic.file ? path.relative(root, diagnostic.file.fileName) : ""}:${diagnostic.code}:${normalize(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))}`));
  for (const match of diagnostics) assert.ok(baseline.has(`${match[1]}:${match[2]}:${normalize(match[3])}`), `introduced TypeScript diagnostic: ${match[1]} TS${match[2]}`);
  console.log(`Full tsc: FAIL (${diagnostics.length} verified pre-existing diagnostics); changed-file typecheck: PASS (0 diagnostics)`);
} else console.log("Full tsc: PASS (0 diagnostics)");

const files = [...changed].filter((name) => fs.existsSync(path.join(root, name)));
const lintArgs = ["run", "lint", "--", "--ignore-pattern", "**/*", "--ignore-pattern", "!src/", "--ignore-pattern", "!src/**/", "--ignore-pattern", "!tests/"];
for (const file of files) lintArgs.push("--ignore-pattern", `!${file}`);
lintArgs.push("--no-warn-ignored", "--max-warnings", "0");
const lint = spawnSync("npm", lintArgs, { cwd: root, encoding: "utf8", timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
assert.ifError(lint.error);
console.log(lint.stdout + lint.stderr);
assert.equal(lint.status, 0, "changed-file npm run lint failed");
console.log(`Changed-file lint: PASS (${files.length} files)`);
console.log("SLACK APP CHECKS PASSED");
