const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
const base = git("merge-base", "origin/production", "HEAD");
const files = [...new Set([...git("diff", "--name-only", base).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")])].filter((file) => /\.tsx?$/.test(file) && fs.existsSync(path.join(root, file)));
assert.ok(files.length > 0);
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const options = { ...parsed.options, noEmit: true, incremental: false };
const originals = new Map();
for (const file of files) {
  try { originals.set(path.join(root, file), git("show", `${base}:${file}`)); }
  catch { originals.set(path.join(root, file), null); }
}
function diagnostics(baseline) {
  const host = ts.createCompilerHost(options);
  if (baseline) {
    const read = host.readFile.bind(host);
    host.readFile = (file) => originals.has(file) ? originals.get(file) ?? undefined : read(file);
  }
  const roots = [...files.filter((file) => !baseline || originals.get(path.join(root, file)) !== null).map((file) => path.join(root, file)), ...parsed.fileNames.filter((file) => file.endsWith(".d.ts"))];
  const program = ts.createProgram(roots, options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    file: diagnostic.file ? path.relative(root, diagnostic.file.fileName) : "config",
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  }));
}
const before = diagnostics(true);
const counts = new Map();
for (const item of before) { const key = JSON.stringify(item); counts.set(key, (counts.get(key) ?? 0) + 1); }
const after = diagnostics(false);
const newErrors = after.filter((item) => {
  const key = JSON.stringify(item);
  if (!counts.get(key)) return true;
  counts.set(key, counts.get(key) - 1);
  return false;
});
for (const error of newErrors) console.error(`${error.file}: TS${error.code}: ${error.message}`);
assert.equal(newErrors.length, 0, "New scoped TypeScript diagnostics");
console.log(`Changed-file typecheck passed: ${files.length} roots, no new diagnostics, ${after.length} existing dependency diagnostics compared against the merge base.`);
