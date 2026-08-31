const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.join(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const visibility = read("src/components/Global/mobileShellVisibility.ts");
const provider = read("src/components/ProviderGlobal/GloablProviders.tsx");
const primaryDock = read("src/components/Global/MobileTabBar.tsx");
const header = read("src/components/Global/MobileHeaderStrip.tsx");
const inbox = read("src/app/inbox/Inbox.tsx");
const agentInbox = read("src/app/inbox/agent/AgentInbox.tsx");
const splitDock = read("src/components/notifications/MobileInboxSplitDock.tsx");
const dockHeightPath = path.join(
  root,
  "src/components/Global/mobileDockHeight.ts",
);
const dockHeight = read("src/components/Global/mobileDockHeight.ts");
const {
  clearMobileDockHeight,
  publishMobileDockHeight,
  releaseMobileDockHeight,
} = jiti(dockHeightPath);

test("Inbox routes replace the regular mobile navigation", () => {
  assert.match(visibility, /isMobileInboxPath/);
  assert.match(
    visibility,
    /shouldShowMobileDock\(pathname\) && !isMobileInboxPath\(pathname\)/,
  );
  assert.match(provider, /shouldShowMobilePrimaryDock\(pathname\)/);
  assert.match(primaryDock, /shouldShowMobilePrimaryDock\(pathname\)/);
  assert.match(
    provider,
    /mobileBottomInsetVisible\s*=\s*showMobileBottomInset && mobileBoardControlsReady/,
  );
  assert.match(provider, /mobileTabBarVisible=\{mobileBottomInsetVisible\}/);
});

test("personal and agent Inbox keep their own split data and deep-link callbacks", () => {
  for (const page of [inbox, agentInbox]) {
    assert.match(page, /<MobileInboxSplitDock/);
    assert.match(
      page,
      /tabs=\{_notificationsTQ\?\.structuredData\?\.tabs \?\? \[\]\}/,
    );
    assert.match(page, /activeIndex=\{globalFocus\.currSplit\}/);
    assert.match(page, /onSelect=\{navigateTabs\}/);
  }
});

test("a stale dock cleanup cannot clear the replacement dock height", () => {
  const values = new Map();
  const rootElement = {
    style: {
      setProperty: (name, value) => values.set(name, value),
      removeProperty: (name) => values.delete(name),
    },
  };
  const primaryOwner = {};
  const inboxOwner = {};

  publishMobileDockHeight(rootElement, primaryOwner, "64px");
  publishMobileDockHeight(rootElement, inboxOwner, "72px");
  releaseMobileDockHeight(rootElement, primaryOwner);
  assert.equal(values.get("--mobile-dock-h"), "72px");

  releaseMobileDockHeight(rootElement, inboxOwner);
  assert.equal(values.has("--mobile-dock-h"), false);

  publishMobileDockHeight(rootElement, primaryOwner, "64px");
  clearMobileDockHeight(rootElement, primaryOwner);
  assert.equal(values.get("--mobile-dock-h"), "0px");

  publishMobileDockHeight(rootElement, inboxOwner, "72px");
  clearMobileDockHeight(rootElement, primaryOwner);
  assert.equal(values.get("--mobile-dock-h"), "72px");
  assert.match(dockHeight, /WeakMap/);
});

test("the mobile header stays contextual without duplicating Inbox split controls", () => {
  assert.match(header, /<Strip lead="Inbox" items=\{\[\]\} \/>/);
  assert.doesNotMatch(header, /useInboxSplits|InboxStrip/);
});

test("the split dock is reachable, scrollable, and owns shell spacing safely", () => {
  assert.match(splitDock, /min-h-\[44px\] min-w-\[44px\]/);
  assert.match(splitDock, /overflow-x-auto/);
  assert.match(splitDock, /focus-visible:ring-2/);
  assert.match(splitDock, /aria-selected=\{active\}/);
  assert.match(splitDock, /safe-area-inset-bottom/);
  assert.match(splitDock, /publishMobileDockHeight/);
  assert.match(splitDock, /releaseMobileDockHeight/);
  assert.match(primaryDock, /publishMobileDockHeight/);
  assert.match(primaryDock, /releaseMobileDockHeight/);
  assert.doesNotMatch(splitDock, /removeProperty\("--mobile-dock-h"\)/);
  assert.doesNotMatch(primaryDock, /removeProperty\("--mobile-dock-h"\)/);
  assert.match(splitDock, /ArrowRight/);
  assert.match(splitDock, /ArrowLeft/);
  assert.doesNotMatch(splitDock, /event\.key === "Tab"/);
  assert.match(
    splitDock,
    /hidden = showAiChatInterface \|\| commentComposerOpen/,
  );
  assert.match(splitDock, /if \(hidden\) return null/);
  assert.match(
    splitDock,
    /if \(hidden\) \{\s*clearMobileDockHeight\(root, mobileInboxSplitDockOwner\);/,
  );
  assert.match(
    primaryDock,
    /if \(hidden\) \{\s*clearMobileDockHeight\(root, mobileTabBarDockOwner\);/,
  );
  assert.match(splitDock, /}, \[hidden\]\);/);
  assert.match(splitDock, /const observer = new ResizeObserver\(publishHeight\)/);
  assert.match(inbox, /if \(isMbl && e\.keyCode === KeyCodes\.TAB\) return/);
  assert.match(
    agentInbox,
    /if \(isMbl && e\.keyCode === KeyCodes\.TAB\) return/,
  );
});

// HTPR-5555: the split labels sat far apart on mobile because each tab carried
// 16px of side padding on top of the scroller's own inset. Keep them tight
// while the 44px touch target still holds.
test("split tabs stay close together without losing their touch target", () => {
  assert.match(splitDock, /min-h-\[44px\] min-w-\[44px\][^"]*px-2 text-dense/);
  assert.doesNotMatch(splitDock, /px-4 text-dense/);
});
