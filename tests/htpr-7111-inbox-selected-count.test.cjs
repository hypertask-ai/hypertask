// HTPR-7111: inbox shows "N selected" next to the header buttons, like My Tasks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
globalThis.React = React;
const { renderToStaticMarkup } = require("react-dom/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, jsx: { runtime: "automatic" } });
const { InboxSelectedCount } = jiti(path.join(root, "src/app/inbox/InboxSelectedCount.tsx"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = (enabled, count) =>
  renderToStaticMarkup(React.createElement(InboxSelectedCount, { enabled, count }));

test("flag on shows N selected, as My Tasks does for any count above zero", () => {
  assert.match(html(true, 1), />1 selected</);
  assert.match(html(true, 12), />12 selected</);
  assert.match(html(true, 3), /whitespace-nowrap/);
});

test("nothing shows with zero selected or with the flag off", () => {
  assert.equal(html(true, 0), "");
  assert.equal(html(false, 5), "");
});

test("the header ButtonGroup renders it behind the ticket flag", () => {
  const src = read("src/app/inbox/Inbox.tsx");
  assert.match(src, /useFlag\(HTPR_7111_INBOX_SELECTED_COUNT_FLAG\)/);
  assert.match(src, /<InboxSelectedCount[\s\S]*count=\{selectedIdsArray\.length\}/);
});

test("flag defaults to Owner + QA (feature kind)", () => {
  const def = read("src/lib/flags/definitions/htpr-7111-inbox-selected-count.ts");
  assert.match(def, /kind: "feature"/);
  assert.doesNotMatch(def, /everyone/i);
});

test("Archive button and E key run the same context archive of the selected set", () => {
  const inbox = read("src/app/inbox/Inbox.tsx");
  const split = read("src/components/notifications/inboxSplit/index.tsx");
  const ctx = read("src/lib/contexts/Inbox/BulkSelectionContext.tsx");
  assert.match(inbox, /const \{ selectedIdsArray, handleBulkArchive \} = useBulkSelectionContext\(\)/);
  assert.match(split, /key: "archive"[\s\S]*?handler: handleBulkArchive/);
  assert.match(split, /handleBulkArchive,[\s\S]*?\} = useBulkSelectionContext\(\)/);
  assert.match(ctx, /Array\.from\(selectedIds\)[\s\S]*?bulkArchiveFromProps\(selectedNotifications\)/);
});
