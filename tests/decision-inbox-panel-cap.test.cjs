const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const mod = { exports: {} };
new Function("module", "exports", ts.transpileModule(read("src/components/notifications/visibleDecisionRows.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(mod, mod.exports);
const { visibleDecisionRows, DECISION_INBOX_COLLAPSED_ROWS } = mod.exports;
const rows = (n) => Array.from({ length: n }, (_, i) => i + 1);

test("3 rows: all shown, no button needed", () => {
  assert.equal(visibleDecisionRows(rows(3), false).length, 3);
  assert.ok(!(3 > DECISION_INBOX_COLLAPSED_ROWS));
});

test("12 rows: collapsed shows the oldest 5, expanded shows all 12", () => {
  assert.deepEqual(visibleDecisionRows(rows(12), false), [1, 2, 3, 4, 5]);
  assert.equal(visibleDecisionRows(rows(12), true).length, 12);
});

test("panel renders the Show all (N) / Show fewer button only above the cap", () => {
  const src = read("src/components/notifications/DecisionInboxPanel.tsx");
  assert.match(src, /data\.length > DECISION_INBOX_COLLAPSED_ROWS/);
  assert.match(src, /`Show all \(\$\{data\.length\}\)`/);
  assert.match(src, /"Show fewer"/);
});
