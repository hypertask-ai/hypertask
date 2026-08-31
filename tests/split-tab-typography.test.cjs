const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const tailwindConfig = read("tailwind.config.ts");
const splitTabSources = [
  read("src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx"),
  read("src/components/notifications/inboxSplit/SplitTitle.tsx"),
];

test("sidebar board names and inbox split tabs use the 14px content token", () => {
  assert.match(tailwindConfig, /["']content["']\s*:\s*["']14px["']/);

  for (const source of splitTabSources) {
    assert.match(source, /\btext-content\b/);
    assert.doesNotMatch(source, /\btext-\[14\.5px\]\b/);
  }
});
