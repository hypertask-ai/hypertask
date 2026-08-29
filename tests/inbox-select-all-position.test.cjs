const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const inboxSplitSource = fs.readFileSync(
  path.join(root, "src/components/notifications/inboxSplit/index.tsx"),
  "utf8",
);

test("the select-all control shares the intended date-group header gutter", () => {
  assert.match(
    inboxSplitSource,
    /const groupedInboxEntries = Object\.entries\(groupedInboxItems\)/,
  );
  assert.match(
    inboxSplitSource,
    /const selectAllGroupKey = groupedInboxItems\.today[\s\S]*?groupedInboxEntries\[groupedInboxEntries\.length - 1\]/,
  );
  assert.match(
    inboxSplitSource,
    /const renderSelectAllControl[\s\S]*?<SelectionCheckbox/,
  );
  assert.match(
    inboxSplitSource,
    /inbox-row-gutter[\s\S]*?groupKey === selectAllGroupKey && renderSelectAllControl\(\)[\s\S]*?<h3 className="inbox-text-left/,
  );
});

test("an empty active split keeps a global select-all fallback", () => {
  assert.match(
    inboxSplitSource,
    /_notifications\.length === 0[\s\S]*?activeDrafts\.length === 0[\s\S]*?selectedIdsArray\.length > 0[\s\S]*?renderSelectAllControl\(\)[\s\S]*?Selected/,
  );
});

test("split-tab headers no longer own the select-all checkbox", () => {
  for (const relativePath of [
    "src/app/inbox/Inbox.tsx",
    "src/app/inbox/agent/AgentInbox.tsx",
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const splitTitles = source.slice(
      source.indexOf("const SplitTitlesContainer"),
    );
    assert.doesNotMatch(splitTitles, /<SelectionCheckbox/);
  }
});
