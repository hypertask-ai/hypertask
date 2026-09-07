// The board publishes currentProjectAtom before paint. The keyboard hook once
// wrote its own render-time value back in a later effect, so an initial null
// could overwrite the loaded board and leave Manage board columns empty.
const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const hookSource = readFileSync(
  path.join(process.cwd(), "src/hooks/Homepage/useHandleKeyDownOperations.ts"),
  "utf8",
);

test("the board key handler only reads currentProjectAtom", () => {
  assert.match(hookSource, /useRecoilValue\(currentProjectAtom\)/);
  assert.doesNotMatch(hookSource, /useRecoilState\(currentProjectAtom\)/);
  assert.doesNotMatch(hookSource, /setCurrentProject\(_currentProject\)/);
});
