const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const provider = fs.readFileSync(
  path.join(root, "src/components/ProviderGlobal/GloablProviders.tsx"),
  "utf8"
);

test("closed optional shell features stay behind dynamic imports", () => {
  const optionalModules = [
    "sidebars/RightSidebar",
    "sidebars/leftSidebar",
    "sidebars/keyboardShortcuts",
    "Modals/GuestLoginModal",
    "Modals/AnnouncementSlide/AnnouncementSlide",
    "Modals/AnnouncementBanner/AnnouncementBanner",
    "Modals/MobileBlockingOverlay/MobileBlockingOverlay",
    "Modals/EmailVerificationModal",
    "Global/MobileTabBar",
    "Global/MobileCreateTaskButton",
    "Global/MobilePullDownCommand",
    "Global/MobileTopBar",
    "Global/BottomSettings_QuickTips",
    "Global/NotificationPromoteBanner",
    "Global/CookieConsentBanner",
  ];

  for (const modulePath of optionalModules) {
    assert.match(
      provider,
      new RegExp(`dynamic\\([\\s\\S]{0,180}${modulePath.replaceAll("/", "\\/")}`),
      `${modulePath} must remain out of the common static shell graph`
    );
  }
});

test("task detail starts both required chat chunks without a serial waterfall", () => {
  assert.match(provider, /const AIChatLayout = lazy\(loadAIChatLayout\)/);
  assert.match(provider, /const ChatProvider = lazy\(loadChatProvider\)/);
  assert.match(
    provider,
    /useEffect\(\(\) => \{[\s\S]*?if \(!isTaskDetailPage\) return;[\s\S]*?Promise\.all\(\[loadChatProvider\(\), loadAIChatLayout\(\)\]\)[\s\S]*?\}, \[isTaskDetailPage\]\)/,
  );
  assert.doesNotMatch(provider, /import AIChatLayout from/);
  assert.doesNotMatch(provider, /import \{ ChatProvider \} from/);
});

test("failed chat chunk loads can be retried", () => {
  for (const [loader, promise] of [
    ["loadAIChatLayout", "aiChatLayoutPromise"],
    ["loadChatProvider", "chatProviderPromise"],
  ]) {
    assert.match(
      provider,
      new RegExp(
        `const ${loader} = \\(\\) => \\{[\\s\\S]*?\\.catch\\(\\(error\\) => \\{\\s*${promise} = null;\\s*throw error;`,
      ),
      `${loader} must clear its rejected cached promise`,
    );
  }
});

test("global task creation does not request its chunk while closed", () => {
  assert.match(
    provider,
    /showGlobalCreateHTCTask\.show && \([\s\S]*?<CreateTaskGlobally/
  );
});

test("mobile visibility checks live outside the optional component chunks", () => {
  assert.match(provider, /from "\.\.\/Global\/mobileShellVisibility"/);
  assert.doesNotMatch(
    provider,
    /import Mobile(?:TabBar|TopBar|PullDownCommand) from/
  );
  assert.match(provider, /allowShowSettings && !mbl/);
  assert.match(provider, /!mbl && <NotificationPromoteBanner \/>/);
  assert.match(provider, /!currentUser && <CookieConsentBanner \/>/);
});

test("the disabled tutorial runtime never enters the app shell", () => {
  assert.doesNotMatch(provider, /PageComponents\/LearnTutorial\/TutorialOverlay/);
  assert.doesNotMatch(provider, /<TutorialOverlay/);
  assert.match(provider, /getLearnTutorialStorageKey\(currentUser\.id\)/);
  assert.match(provider, /sessionStorage\.removeItem/);
});
