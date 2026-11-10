const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const stickyKey = "htpr-9029-sticky-splits";
const inbox = fs.readFileSync(path.join(root, "src/app/inbox/Inbox.tsx"), "utf8");
const container = inbox.slice(inbox.indexOf("const SplitTitlesContainer"));

test("the flag is a feature that starts at Owner + QA", () => {
  const { default: flag, HTPR_9029_STICKY_SPLITS_FLAG: exported } = loadModule("src/lib/flags/definitions/htpr-9029-sticky-splits.ts");
  assert.equal(exported, stickyKey);
  assert.equal(flag.key, stickyKey);
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "new");
});

test("flag on: the split bar pins to the top with an opaque page background", () => {
  assert.match(container, /const stickySplits = useFlag\(HTPR_9029_STICKY_SPLITS_FLAG\)/);
  assert.match(container, /stickySplits\s*\?\s*`sticky top-0 z-sticky \$\{contentGap \? "bg-taskDetailPage" : "bg-containerBackground"\}/);
});

test("the thin line shows only once the list is scrolled", () => {
  assert.match(container, /\$\{listScrolled \? "shadow-\[0_1px_0_0_var\(--border-light-gray-thin\)\]" : ""\}/);
  assert.match(container, /if \(!stickySplits\) return;/);
  assert.match(container, /document\.addEventListener\("scroll", onScroll, \{ capture: true, passive: true \}\)/);
  assert.match(container, /document\.removeEventListener\("scroll", onScroll, \{ capture: true \}\)/);
});

test("still allowed: flag off keeps today's non-sticky bar", () => {
  assert.match(container, /:\s*"relative"\s*\}\s*hidden items-baseline pr-\[16px\] pt-4/);
});
