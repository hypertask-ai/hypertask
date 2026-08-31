const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tabSources = [
  "src/app/search/SearchComp.tsx",
  "src/app/inbox/agent/AgentInbox.tsx",
  "src/components/Common/TaskRowComponents/TaskListRow.tsx",
  "src/components/notifications/inboxSplit/SplitTitle.tsx",
  "src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx",
];

test("tab labels inherit the UI font instead of Dia heading typography", () => {
  for (const relativePath of tabSources) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /<h[1-6]\b[^>]*\bfooter_tags\b[^>]*>/,
      `${relativePath} must not mark a tab label as a heading`,
    );
  }
});
