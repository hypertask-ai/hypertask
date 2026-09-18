const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/mobile-comment-viewport-jiti-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);

const {
  MOBILE_PRIMARY_DOCK_MIN_PX,
  getAgentChatMobileBottomInset,
  parseCssPixelLength,
} = jiti(path.join(root, "src/lib/mobileCommentViewport.ts"));

const chat = fs.readFileSync(
  path.join(root, "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);

const QA_VIEWPORT_HEIGHT = 844;
const QA_TAB_BAR_TOP = 779;
const QA_TAB_BAR_HEIGHT = QA_VIEWPORT_HEIGHT - QA_TAB_BAR_TOP;

const composerBottom = (dockHeight, keyboardInset = 0) =>
  QA_VIEWPORT_HEIGHT -
  getAgentChatMobileBottomInset({ dockHeight, keyboardInset });

test("QA tab bar height is the 65px dock measured at 390x844", () => {
  assert.equal(QA_TAB_BAR_HEIGHT, 65);
  assert.equal(MOBILE_PRIMARY_DOCK_MIN_PX, QA_TAB_BAR_HEIGHT);
});

test("reload with a cleared 0px dock var keeps the composer above the tab bar", () => {
  assert.equal(parseCssPixelLength("0px"), 0);
  assert.equal(getAgentChatMobileBottomInset({ dockHeight: 0, keyboardInset: 0 }), 65);
  assert.ok(composerBottom(0) <= QA_TAB_BAR_TOP);
});

test("reload with a 32px dock var no longer overlaps the tab bar by 32px", () => {
  assert.equal(parseCssPixelLength("32px"), 32);
  assert.equal(getAgentChatMobileBottomInset({ dockHeight: 32, keyboardInset: 0 }), 65);
  assert.ok(composerBottom(32) <= QA_TAB_BAR_TOP);
  assert.notEqual(composerBottom(32), 811);
});

test("a measured 65px dock keeps the composer flush with the tab bar", () => {
  assert.equal(getAgentChatMobileBottomInset({ dockHeight: 65, keyboardInset: 0 }), 65);
  assert.equal(composerBottom(65), QA_TAB_BAR_TOP);
});

test("keyboard open drops the dock pad so the composer sits on the keyboard", () => {
  assert.equal(getAgentChatMobileBottomInset({ dockHeight: 65, keyboardInset: 400 }), 0);
  assert.equal(composerBottom(65, 400), QA_VIEWPORT_HEIGHT);
});

test("Agent Chat applies the computed inset on the mobile shell", () => {
  assert.match(chat, /getAgentChatMobileBottomInset/);
  assert.match(chat, /paddingBottom: mobileComposerBottomInset/);
  assert.match(
    chat,
    /pb-\[max\(var\(--mobile-dock-h,64px\),64px\)\]/,
  );
  assert.match(chat, /useLayoutEffect\(\(\) => \{[\s\S]*max-width: 899px/);
  console.log("htpr-6041-composer-inset: passed");
});
