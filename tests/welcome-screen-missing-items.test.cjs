const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/components/AI_CHAT/WelcomeScreen.tsx"),
  "utf8",
);

test("welcome screen tolerates a column without an items list", () => {
  assert.match(source, /items:\s*\(section\.items \?\? \[\]\)\.filter\(/);
  assert.doesNotMatch(source, /items:\s*section\.items\.filter\(/);
});
