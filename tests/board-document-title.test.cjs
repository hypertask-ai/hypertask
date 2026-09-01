const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("the board reacts to both saved and built-in view changes", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /getBuiltinView\(\s*getActiveBoardViewId\(_currentProject, activeBuiltinViews\)/,
  );
  assert.match(source, /savedView\?\.type === "Default" \? undefined/);
  assert.match(source, /\[_currentProject, activeBuiltinViews\]/);
});
