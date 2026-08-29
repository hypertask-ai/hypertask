const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/app/api/mcp/projects/route.ts"),
  "utf8",
);

test("project listings expose the ticket prefix needed by CLI show", () => {
  assert.match(source, /uniqueIdentifier\?: string/);
  assert.match(source, /uniqueIdentifier: true/);
  assert.match(source, /uniqueIdentifier: project\.uniqueIdentifier \|\| undefined/);
});
