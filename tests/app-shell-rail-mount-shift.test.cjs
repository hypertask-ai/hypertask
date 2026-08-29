const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// HTPR-5725: returning to a page painted content too far left, then slid it
// into place over a second. Root cause: the --app-shell-rail-w CSS var (which
// every rail-padded container reads) was only set in a useEffect, which
// commits AFTER the browser's first paint — so that first paint used the
// var's 48px fallback regardless of the real (possibly 130px) rail width.

const railSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx",
  ),
  "utf8",
);
const cssVarEffect = railSource.match(
  /\/\/ Page content offsets[\s\S]*?\}, \[wide\]\);/,
)?.[0] ?? "";

test("the --app-shell-rail-w sync effect runs before paint (useLayoutEffect, not useEffect)", () => {
  assert.match(cssVarEffect, /useLayoutEffect\(\(\) => \{/);
  assert.doesNotMatch(cssVarEffect, /^\s*useEffect\(/m);
});

test("the effect never clears --app-shell-rail-w on unmount (every reader is gated by the current page's own rail-on flag)", () => {
  assert.doesNotMatch(cssVarEffect, /removeProperty/);
});

const inboxSource = fs.readFileSync(
  path.resolve(__dirname, "../src/app/inbox/Inbox.tsx"),
  "utf8",
);
const railPaddedContainer = inboxSource.match(
  /flex items-center justify-center flex-col w-full min-h-fit[^`]*/,
)?.[0] ?? "";
const railPaddedBottomContainer = inboxSource.match(
  /search_inbox_container min-h-screen inbox_tag_mobile_view[\s\S]*?ease-in-out/,
)?.[0] ?? "";

test("the rail-padded Inbox containers no longer carry a 1s mount animation", () => {
  assert.doesNotMatch(railPaddedContainer, /duration-1000/);
  assert.doesNotMatch(railPaddedBottomContainer, /duration-1000/);
  assert.match(railPaddedContainer, /duration-200/);
  assert.match(railPaddedBottomContainer, /duration-200/);
});

// Cold loads (no React mounted yet) still painted SSR HTML at the CSS
// fallback (48px, rail on) until AppShellRail's own effect corrected it,
// regardless of the visitor's actual persisted rail state. A blocking
// <head> script seeds --app-shell-rail-w from the same localStorage blob the
// atoms persist to, before the browser's first paint — for both the
// expanded (130px) and fully-off (0px) cases.
const layoutSource = fs.readFileSync(
  path.resolve(__dirname, "../src/app/layout.tsx"),
  "utf8",
);

test("layout seeds --app-shell-rail-w from localStorage before first paint, for both the expanded and rail-off cases", () => {
  assert.match(layoutSource, /localStorage\.getItem\('recoil-persist'\)/);
  assert.match(layoutSource, /appShellRailExpanded===true.*130px/);
  assert.match(layoutSource, /appShellRail===false.*0px/);
});

// The layout boot script above sets one shared CSS var on <html>. Every page
// that pads/offsets by the rail must read that var (not a hardcoded 48px or
// 130px) or it won't benefit from the pre-paint fix at all.
const RAIL_CONSUMER_FILES = [
  "../src/app/inbox/Inbox.tsx",
  "../src/app/all-tasks/AllTasks.tsx",
  "../src/app/my-tasks/MyTasks.tsx",
  "../src/app/archived/ArchivedComp.tsx",
  "../src/app/agents/AgentsRegister.tsx",
  "../src/app/agents/[agentId]/AgentDetail.tsx",
  "../src/app/report/ReportsOverview.tsx",
  "../src/app/report/[projectSlug]/velocity/VelocityReport.tsx",
  "../src/app/detail/[...slug]/TaskDetailComp.tsx",
  "../src/app/[...boardURL]/LandingPage.tsx",
  "../src/components/PageComponents/Calendar/index.tsx",
  "../src/components/Global/BottomSettings_QuickTips.tsx",
  "../src/components/Global/NotificationPromoteBanner.tsx",
];

test("every appShellRailOn consumer offsets via the shared --app-shell-rail-w var", () => {
  for (const relPath of RAIL_CONSUMER_FILES) {
    const source = fs.readFileSync(path.resolve(__dirname, relPath), "utf8");
    assert.match(
      source,
      /var\(--app-shell-rail-w/,
      `${relPath} should read var(--app-shell-rail-w, ...) rather than a hardcoded rail offset`,
    );
  }
});
