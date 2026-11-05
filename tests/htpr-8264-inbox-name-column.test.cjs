const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("inbox name column flag is a small improvement that defaults to Everyone", () => {
  const { default: flag, HTPR_8264_INBOX_NAME_COLUMN_FLAG: key } = loadModule("src/lib/flags/definitions/htpr-8264-inbox-name-column.ts");
  assert.equal(key, "htpr-8264-inbox-name-column");
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("the sender gets a fixed 180px column only with both inbox flags on", () => {
  const row = read("src/components/notifications/NotificationRow.tsx");
  assert.match(row, /const inboxNameColumn = useFlag\(HTPR_8264_INBOX_NAME_COLUMN_FLAG\)/);
  assert.match(row, /inboxRowFill && inboxNameColumn \? 'md:w-\[180px\] md:min-w-\[180px\] md:max-w-\[180px\] md:shrink-0' : inboxRowFill \? 'md:shrink-0 md:min-w-0 md:max-w-\[180px\]'/);
});

test("the ticket number gets a fixed 72px slot only in inbox rows with the flag on", () => {
  const title = read("src/components/Common/TaskRowComponents/TaskTitle.tsx");
  assert.match(title, /const nameColumn = useFlag\(HTPR_8264_INBOX_NAME_COLUMN_FLAG\) && rowFill && Boolean\(notification\)/);
  assert.match(title, /ticketNumber\(isIbxSlctd\), nameColumn && 'md:inline-block md:w-\[72px\] md:shrink-0'\)/);
  const blocked = title.indexOf("BLOCKED ·");
  const ticket = title.indexOf("ticketNumber(isIbxSlctd), nameColumn");
  assert.ok(blocked > 0 && blocked < ticket, "the BLOCKED chip stays before the ticket number");
});
