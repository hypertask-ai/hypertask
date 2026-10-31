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
  assert.doesNotMatch(inbox, /\{\s*!isMbl && <InboxNotifyNudge/);
});

test("the mobile shape stacks the message and gives every control a 44px target", () => {
  assert.match(nudge, /if \(mbl\) \{/);
  assert.match(nudge, /or by email/);
  const mobileBranch = nudge.slice(
    nudge.indexOf("if (mbl) {"),
    nudge.indexOf("  return (\n    <div className=\"flex w-full shrink-0 flex-wrap"),
  );
  assert.equal(mobileBranch.match(/MOBILE_TARGET/g).length, 3);
  assert.match(mobileBranch, /aria-label="Dismiss notification nudge"/);
});

test("the nudge cannot squash or grow the bounded mobile inbox scroller", () => {
  assert.equal(nudge.match(/flex w-full shrink-0/g).length, 2);
  assert.match(
    globals,
    /\.mobile-tab-bar-content \.search_inbox_container,[\s\S]{0,120}min-height: 0;\s*\n\s*height: calc\(100svh - var\(--mobile-chrome-h\)\);/,
  );
});

test("the notification document initializes hydration only, never a later client remount", () => {
  const start = nudge.indexOf('  const inboxDocument =');
  const end = nudge.indexOf('\n  useEffect(', start);
  const readState = new Function('hydrated', 'snapshot', 'getInboxDocument', 'useState', 'bothOff', 'pushDenied', nudge.slice(start, end) + '\nreturn { mounted, dismissed, visible };');
  const snapshot = { scope: { accountId: 985 }, data: { nudge: { visible: true, pushDenied: false } } };
  const state = hydrated => readState(hydrated, snapshot, value => value, value => [typeof value === 'function' ? value() : value], true, false);
  assert.deepEqual(state(false), { mounted: true, dismissed: false, visible: true });
  assert.deepEqual(state(true), { mounted: false, dismissed: true, visible: false });
});

test("a push attempt that yields no token falls back to the email action", () => {
  assert.match(hook, /setPushUnavailable\(true\)/);
  assert.match(
    hook,
    /const pushDenied =\s*\n\s*fcmData\.permissionStatus === "denied" \|\| pushUnavailable;/,
  );
  assert.match(nudge, /const denied = !hydrated && inboxDocument \? inboxDocument\.data\.nudge\.pushDenied : pushDenied;/);
  assert.equal(nudge.match(/denied \? enableEmail : enablePush/g).length, 2);
  assert.equal(
    nudge.match(/denied \? "Get updates by email" : "Enable notifications"/g).length,
    2,
  );
});
