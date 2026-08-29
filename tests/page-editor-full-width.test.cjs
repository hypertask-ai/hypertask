const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/app/page/[publicId]/PageEditor.tsx"),
  "utf8",
);

// HTPR-5484: Pages are where agents render designs, so the editor has to give
// them the whole width after the app rail. A re-introduced max-width or card
// surface silently takes that space back.
test("the editor is not constrained to a centred document column", () => {
  assert.doesNotMatch(source, /max-w-\[900px\]/);
  assert.doesNotMatch(source, /mx-auto w-full/);
});

test("the editor keeps no card chrome", () => {
  assert.doesNotMatch(source, /bg-taskDetal-container/);
  assert.doesNotMatch(source, /rounded-xl/);
});

test("the slim utility row survives", () => {
  assert.match(source, /Back to task/);
  assert.match(source, /Version \{version\}/);
});
