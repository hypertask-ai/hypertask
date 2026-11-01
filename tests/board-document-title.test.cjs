const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const { buildBoardDocumentTitle } = jiti(
  path.join(root, "src/lib/boardDocumentTitle.ts"),
);

test("puts the active view before the board and Hypertask", () => {
  assert.equal(
    buildBoardDocumentTitle("Product", "Bugs"),
    "Bugs • Product • Hypertask",
  );
});

test("keeps the existing board-only title when no named view is active", () => {
  assert.equal(buildBoardDocumentTitle("Product"), "Product • Hypertask");
  assert.equal(buildBoardDocumentTitle("Product", "  "), "Product • Hypertask");
});
