const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/lib/fonts/ibmPlexSans.ts"),
  "utf8"
);

test("common signed-in Plex typography uses one variable font resource", () => {
  assert.match(source, /weight: "variable"/);
  assert.doesNotMatch(source, /weight: \[/);
  assert.match(source, /preload: false/);
  assert.match(source, /variable: "--font-plex"/);
});
