const assert = require("node:assert/strict");
const test = require("node:test");

test("a detected break is the negative control and a missed break is not", async () => {
  const { finish, themeLanded } = await import("../.claude/skills/verify-qa/scripts/drive-grade.mjs");
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    assert.equal(finish("board", [{ name: "columns visible", pass: false }], "columns", "columns visible"), 0);
    assert.match(logs.at(-1), /^negative control ok: columns break failed the step$/);
    assert.equal(finish("board", [{ name: "columns visible", pass: false }, { name: "fixture cleaned", pass: false }], "columns", "columns visible"), 1);
    assert.equal(finish("board", [{ name: "columns visible", pass: false }, { name: "run", pass: false }], "columns", "columns visible"), 1);
    assert.equal(finish("board", [{ name: "columns visible", pass: true }], "columns", "columns visible"), 1);
    assert.match(logs.at(-1), /^negative control FAIL: columns break was not detected$/);
    assert.equal(finish("board", [{ name: "columns visible", pass: true }, { name: "card visible", pass: false }], "", "columns visible"), 1);
    assert.match(logs.at(-1), /^board FAIL: card visible$/);
    assert.equal(finish("flags", [{ name: "switch without an agent token is refused", pass: true }], "", ""), 0);
    assert.match(logs.at(-1), /^flags ok$/);
  } finally {
    console.log = original;
  }
  assert.equal(themeLanded("graphite", "graphite-2"), true);
  assert.equal(themeLanded("graphite", "porcelain"), false);
  assert.equal(themeLanded("porcelain", "porcelain"), true);
  console.log("drive-break ok");
});
