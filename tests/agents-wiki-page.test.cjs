const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const route = fs.readFileSync(
  path.join(root, "src/app/wiki/agents/page.tsx"),
  "utf8",
);
const guide = fs.readFileSync(path.join(root, "openwiki/agents.md"), "utf8");

test("the public agents wiki page renders the shared QA-lane guide", () => {
  assert.match(route, /openwiki["\\']?, ["\\']agents\.md/);
  assert.match(route, /markdownToHtml/);
  assert.match(guide, /## QA lane/);
  assert.match(guide, /Bugs → In Progress → AI Review → QA → Done/);
  assert.match(guide, /Nothing moves to \*\*Done\*\* without QA evidence/);
});
