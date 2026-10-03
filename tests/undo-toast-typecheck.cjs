const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const files = [
  "src/components/undoToast/index.tsx",
  "src/components/undoToast/useMobileToastAutoDismiss.ts",
  "src/components/ProviderGlobal/GloablProviders.tsx",
  "src/lib/flags.ts",
  "src/lib/flags/keys.ts",
];
const touchedErrors = (output) => output.split("\n").filter((line) =>
  files.some((file) => line.startsWith(`${file}(`)) && line.includes("error TS"));
// Positive control: never certify a touched diagnostic as external type debt.
assert.equal(touchedErrors(`${files[0]}(1,1): error TS2322: control`).length, 1);
assert.equal(touchedErrors("src/unrelated.ts(1,1): error TS2322: control").length, 0);
const result = spawnSync(process.execPath, [
  require.resolve("typescript/bin/tsc"), "--noEmit", "--incremental", "false", "--pretty", "false",
], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
assert.ifError(result.error);
const output = result.stdout + result.stderr;
assert.ok(result.status === 0 || result.status === 2, output);
assert.deepEqual(touchedErrors(output), [], output);
const externalErrors = output.split("\n").filter((line) => /\(\d+,\d+\): error TS/.test(line));
if (result.status !== 0) assert.ok(externalErrors.length > 0, output);
console.log(`Touched TypeScript clean (${files.length} files; ${externalErrors.length} diagnostics outside scope)`);
