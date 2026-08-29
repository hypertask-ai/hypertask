const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const nudge = read("src/components/notifications/InboxNotifyNudge.tsx");
const hook = read("src/hooks/notifications/useNotificationNudge.ts");
const inbox = read("src/app/inbox/Inbox.tsx");
const globals = read("src/styles/globals.scss");

test("the inbox renders the nudge on every surface, with no mobile gate", () => {
  assert.match(inbox, /import InboxNotifyNudge from "@\/components\/notifications\/InboxNotifyNudge"/);
  assert.match(inbox, /<InboxNotifyNudge \/>/);
  // The row shipped desktop-only once and was reverted; the render site must
  // never be re-wrapped in a device check (HTPR-4721).
  assert.doesNotMatch(inbox, /\{\s*!isMbl && <InboxNotifyNudge/);
});

test("the mobile shape stacks the message and gives every control a 44px target", () => {
  assert.match(nudge, /if \(mbl\) \{/);
  assert.match(nudge, /or by email/);
  // Three controls in the mobile branch: primary, email, dismiss.
  const mobileBranch = nudge.slice(
    nudge.indexOf("if (mbl) {"),
    nudge.indexOf("  return (\n    <div className=\"flex w-full shrink-0 flex-wrap"),
  );
  assert.equal(mobileBranch.match(/MOBILE_TARGET/g).length, 3);
  assert.match(mobileBranch, /aria-label="Dismiss notification nudge"/);
});

test("the nudge cannot squash or grow the bounded mobile inbox scroller", () => {
  // shrink-0 on both roots: the row keeps its height and the list below it
  // absorbs the loss, so search_inbox_container stays the only scroller.
  assert.equal(nudge.match(/flex w-full shrink-0/g).length, 2);
  assert.match(
    globals,
    /\.mobile-tab-bar-content \.search_inbox_container,[\s\S]{0,120}min-height: 0;\s*\n\s*height: calc\(100svh - var\(--mobile-chrome-h\)\);/,
  );
});

test("a push attempt that yields no token falls back to the email action", () => {
  // Web push is unsupported on iOS Safari outside an installed PWA, in-app
  // browsers, and the Android WebView shell. retrieveToken() returns nothing
  // and leaves permissionStatus untouched, so without this the primary mobile
  // button is a dead control (HTPR-4721).
  assert.match(hook, /setPushUnavailable\(true\)/);
  assert.match(
    hook,
    /const pushDenied =\s*\n\s*fcmData\.permissionStatus === "denied" \|\| pushUnavailable;/,
  );
  // Both layouts already route pushDenied to the email action; widening the
  // flag is what makes the unsupported case recover too.
  assert.equal(nudge.match(/pushDenied \? enableEmail : enablePush/g).length, 2);
  assert.equal(
    nudge.match(/pushDenied \? "Get updates by email" : "Enable notifications"/g).length,
    2,
  );
});
