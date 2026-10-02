const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");

test("no source file under src/ is over 1,500 lines", () => {
  const result = spawnSync(process.execPath, ["scripts/check-file-size.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("countLines counts lines with and without a trailing newline", async () => {
  const { countLines } = await import("../scripts/check-file-size.mjs");
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a"), 1);
  assert.equal(countLines("a\nb\n"), 2);
  assert.equal(countLines("a\nb"), 2);
});
