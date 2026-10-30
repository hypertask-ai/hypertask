const { readRefactoredSource } = require("../src/app/detail/[...slug]/taskDetailTestSources.cjs");
const assert = require("node:assert/strict");
const fs = require("./refactored-module-source.cjs");
const path = require("node:path");
const test = require("node:test");


const railSource = readRefactoredSource(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx",
  ),
  "utf8",
);
const cssVarEffect = railSource.match(
  /useLayoutEffect\(\(\) => \{\s*document\.documentElement\.removeAttribute\("data-rail"\)[\s\S]*?\}, \[wide\]\);/,
)?.[0] ?? "";

test("the --app-shell-rail-w sync effect runs before paint (useLayoutEffect, not useEffect)", () => {
  assert.match(cssVarEffect, /useLayoutEffect\(\(\) => \{/);
  assert.doesNotMatch(cssVarEffect, /^\s*useEffect\(/m);
});

test("the effect never clears --app-shell-rail-w on unmount (every reader is gated by the current page's own rail-on flag)", () => {
  assert.doesNotMatch(cssVarEffect, /removeProperty/);
});

const inboxSource = readRefactoredSource(
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

const layoutSource = readRefactoredSource(
  path.resolve(__dirname, "../src/app/layout.tsx"),
  "utf8",
);

test("layout seeds --app-shell-rail-w from localStorage before first paint, for both the expanded and rail-off cases", () => {
  assert.match(layoutSource, /localStorage\.getItem\('recoil-persist'\)/);
  assert.match(layoutSource, /appShellRailExpanded===true.*130px/);
  assert.match(layoutSource, /appShellRail===false.*0px/);
});

const RAIL_CONSUMER_FILES = [
  "../src/app/inbox/Inbox.tsx",
  "../src/app/all-tasks/AllTasks.tsx",
  "../src/app/my-tasks/MyTasks.tsx",
  "../src/app/archived/ArchivedComp.tsx",
  "../src/app/agents/AgentsRegister.tsx",
  "../src/app/agents/[agentId]/AgentDetailView.tsx",
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
    const source = readRefactoredSource(path.resolve(__dirname, relPath), "utf8");
    assert.match(
      source,
      /var\(--app-shell-rail-w/,
      `${relPath} should read var(--app-shell-rail-w, ...) rather than a hardcoded rail offset`,
    );
  }
});
