const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("board-only optional surfaces stay behind intent-only imports", () => {
  const landingPage = read("src/app/[...boardURL]/LandingPage.tsx");
  const desktopHeader = read(
    "src/components/PageComponents/Kanban/HeaderComponents/header.tsx",
  );

  assert.doesNotMatch(
    landingPage,
    /^import TableView from /m,
    "table view must not ship in the default kanban startup chunk",
  );
  assert.match(landingPage, /lazy\([\s\S]*Kanban\/TableView\/TableView/);
  assert.doesNotMatch(landingPage, /^import TrialModal from /m);
  assert.match(landingPage, /lazy\([\s\S]*TrialPlan\/TrialModal/);
  assert.doesNotMatch(desktopHeader, /^import TrialModal from /m);
  assert.match(desktopHeader, /lazy\([\s\S]*TrialPlan\/TrialModal/);

  for (const modulePath of [
    "HeaderComponents/header",
    "HeaderComponents/ViewTabsBar",
    "HeaderComponents/AppShellRail",
    "HeaderComponents/ShellViewControls",
    "HeaderComponents/GuestAuthLinks",
  ]) {
    assert.doesNotMatch(
      landingPage,
      new RegExp(`^import .*${modulePath.replaceAll("/", "\\/")}`, "m"),
      `${modulePath} must not block the mobile Board module graph`,
    );
    assert.match(
      landingPage,
      new RegExp(`lazy\\([\\s\\S]*${modulePath.replaceAll("/", "\\/")}`),
      `${modulePath} must load only on its rendered desktop branch`,
    );
  }
});

test("command palette loads only after command intent", () => {
  for (const relativePath of [
    "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx",
    "src/components/PageComponents/Kanban/TableView/TableView.tsx",
  ]) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /^import HypertasksCommands from /m);
    assert.match(source, /lazy\(\(\) => import\([^)]*commands/);
    assert.match(source, /showCommands\.show && \([\s\S]*<HypertasksCommands/);
  }
});

test("mobile AI sheet runtime loads only when AI chat opens", () => {
  const layout = read("src/components/AI_CHAT/AI_Chat_Layout.tsx");

  assert.doesNotMatch(layout, /^import \{ AppSheet \} from /m);
  assert.match(
    layout,
    /lazy\([\s\S]*Modals\/Sheets\/AppSheet[\s\S]*default: module\.AppSheet/,
  );
  assert.match(layout, /showAiChatInterface && isSidebarMode && isMbl/);
});

test("global mobile board switcher does not pull sheet code into startup", () => {
  const topBar = read("src/components/Global/MobileTopBar.tsx");

  assert.doesNotMatch(topBar, /^import MobileTitleSheet from /m);
  assert.match(topBar, /lazy\(\(\) => import\("\.\/MobileTitleSheet"\)\)/);
  assert.match(topBar, /showBoards && \([\s\S]*<MobileTitleSheet/);
});

test("mobile secondary header controls wait for usable Board paint", () => {
  const provider = read(
    "src/components/ProviderGlobal/GloablProviders.tsx",
  );
  const topBar = read("src/components/Global/MobileTopBar.tsx");
  const startupContext = read("src/lib/contexts/boardStartupContext.tsx");

  assert.match(startupContext, /markBoardUsable/);
  assert.match(provider, /boardUsable=\{mobileBoardControlsReady\}/);
  assert.doesNotMatch(topBar, /^import MobileHeaderStrip from /m);
  assert.match(topBar, /lazy\(\(\) => import\("\.\/MobileHeaderStrip"\)\)/);
  assert.doesNotMatch(topBar, /useGetAnnouncements|useGetUserPreferences/);
  assert.doesNotMatch(
    topBar,
    /currentProjectAtom|currentProject\?\.title|currentProject\?\.name/,
    "the pre-authorization title must not expose stale project data",
  );
  assert.match(topBar, /:\s*"Board";/);
  assert.match(topBar, /deferredControlsReady \? \(/);
  assert.doesNotMatch(topBar, /useHypertasksRecoilStates|useSettingsNavigation/);
  assert.match(topBar, /lazy\(\(\) => import\("\.\/MobileTopBarActions"\)\)/);
  assert.match(topBar, /<MobileTopBarActions/);
  assert.match(provider, /showMobileBottomNav && mobileBoardControlsReady && \(/);
  assert.match(
    provider,
    /const mobileBottomInsetVisible\s*=\s*showMobileBottomInset && mobileBoardControlsReady/,
  );
  assert.match(
    provider,
    /const mobilePullCommandVisible\s*=\s*enableMobilePullDownCommand && mobileBoardControlsReady/,
  );
  assert.doesNotMatch(
    provider,
    /mobileTabBarVisible=\{showMobileBottomInset\}|mobilePullCommandEnabled=\{enableMobilePullDownCommand\}/,
    "the content shell must not reserve space for deferred controls",
  );
  assert.match(provider, /mobileTabBarVisible=\{mobileBottomInsetVisible\}/);
  assert.match(provider, /mobilePullCommandEnabled=\{mobilePullCommandVisible\}/);
});
