const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const inboxSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/inbox/Inbox.tsx"),
  "utf8",
);

test("the inbox restores a system split from the URL after reload", () => {
  assert.match(inboxSource, /const preselectedSplit = queryParams\?\.split;/);
  assert.match(inboxSource, /tab\.project === preselectedSplit/);
  assert.match(
    inboxSource,
    /\(preselectedProject \|\| preselectedSplit\).*preselectedSplitProcessed\.current/s,
  );
});

test("a board split still restores by project id", () => {
  assert.match(
    inboxSource,
    /tab\.projectId === parseInt\(preselectedProject\)/,
  );
});
