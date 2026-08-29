const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const row = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/components/notifications/NotificationRow.tsx",
  ),
  "utf8",
);

test("mobile Inbox reserves the status gutter only when an indicator exists", () => {
  assert.match(
    row,
    /hasInboxStatusIndicator\(notification\) && \([\s\S]*?<Seen notification=\{notification\} className="md:hidden"/,
  );
  assert.match(row, /Boolean\(notification\.task\?\.savedContent\?\.length\)/);
  assert.match(
    row,
    /notification\.task\.waitingOnUserId === notification\.userId/,
  );
  assert.match(
    row,
    /return hasSavedContent \|\| isBlockedByMe \|\| !notification\.seen/,
  );
});

test("the mobile status dot keeps its existing width and dot-to-name gap", () => {
  assert.match(
    row,
    /group relative left-0 flex w-\[10px\] items-center justify-center/,
  );
  assert.match(row, /<span className="flex gap-1 md:gap-1 items-center/);
});
