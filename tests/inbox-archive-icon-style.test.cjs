const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/TaskDetail/TaskOptions/ArchiveTaskNotifications.tsx",
  ),
  "utf8",
);
const archiveIcon = source.match(/<Archive\s+size=\{20\}[\s\S]*?\/>/)?.[0] ?? "";

test("the remove-notification icon carries no accent colour", () => {
  assert.doesNotMatch(archiveIcon, /text-hypertasks-header-blue/);
});

test("the remove-notification icon is drawn at the shared 20px header size", () => {
  assert.match(archiveIcon, /size=\{20\}/);
  assert.match(archiveIcon, /className="keep-stroke task-option-icon/);
  assert.match(archiveIcon, /text-\[#696b6e\]/);
  assert.match(archiveIcon, /hover:text-\[#95999e\]/);
});
