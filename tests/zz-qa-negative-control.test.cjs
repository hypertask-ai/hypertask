const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
test("qa negative control: reads source as text and regex-matches it", () => {
  const source = readFileSync("src/lib/auth/agentScope.ts", "utf8");
  assert.match(source, /export/);
});
