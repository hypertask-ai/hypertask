const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/utils/controllers/share/getProject.ts"),
  "utf8"
);

test("read-only board query excludes private feature metadata", () => {
  assert.match(source, /getProjectViewBaseInclude/);
  assert.doesNotMatch(source, /getProjectViewInclude/);
  assert.doesNotMatch(source, /team:\s*\{/);
  assert.doesNotMatch(source, /googleAccount/);
  assert.doesNotMatch(source, /team_activity/);
});

test("public avatars do not serialize full user records", () => {
  assert.match(source, /user:\s*\{[\s\S]*?id: true,[\s\S]*?photoURL: true/);
  assert.doesNotMatch(source, /user: true/);
  assert.doesNotMatch(source, /owner: true/);
  assert.doesNotMatch(source, /email: true/);
});

test("public task labels and estimates select only rendered fields", () => {
  assert.match(source, /label: \{ select: \{ value: true \} \}/);
  assert.match(source, /priority: \{ select: \{ priority_index: true \} \}/);
  assert.match(source, /estimate: \{ select: \{ estimate_index: true \} \}/);
});
