const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const { shouldShowMobileCreateTaskButton } = jiti(
  path.join(root, "src/components/Global/mobileShellVisibility.ts"),
);
const button = read("src/components/Global/MobileCreateTaskButton.tsx");
const floatingButton = read(
  "src/components/Global/MobileFloatingActionButton.tsx",
);
const provider = read("src/components/ProviderGlobal/GloablProviders.tsx");

test("the mobile create-task action is limited to Board, Calendar, and Inbox", () => {
  for (const pathname of [
    "/project/15",
    "/project/15/table",
    "/calendar",
    "/calendar/week",
    "/inbox",
    "/inbox/agent/abc",
  ]) {
    assert.equal(shouldShowMobileCreateTaskButton(pathname), true, pathname);
  }

  for (const pathname of [
    null,
    "/detail/project-15/5848",
    "/settings",
    "/search",
    "/all-tasks",
    "/chat",
    "/projectile",
    "/calendar-settings",
    "/inbox-old",
  ]) {
    assert.equal(shouldShowMobileCreateTaskButton(pathname), false, pathname);
  }
});

test("the mobile create-task action follows dock and chat visibility", () => {
  assert.match(
    provider,
    /mobileBottomInsetVisible\s*&&\s*!showAiChatInterface\s*&&\s*shouldShowMobileCreateTaskButton\(pathname\)/,
  );
  assert.match(
    provider,
    /mobileCreateTaskButtonVisible && <MobileCreateTaskButton \/>/,
  );
});

test("the mobile create-task wrapper opens the shared modal", () => {
  assert.match(button, /<MobileFloatingActionButton/);
  assert.match(button, /ariaLabel="Create task"/);
  assert.match(button, /label="New task"/);
  assert.match(
    button,
    /onClick=\{\(\) => setCreateTaskModal\(\{ show: true \}\)\}/,
  );
});

test("the shared floating action owns the mobile dock clearance and styling", () => {
  assert.match(floatingButton, /type="button"/);
  assert.match(floatingButton, /aria-label=\{ariaLabel\}/);
  assert.match(floatingButton, /\{icon\}/);
  assert.match(floatingButton, /<span>\{label\}<\/span>/);
  assert.match(floatingButton, /onClick=\{onClick\}/);
  assert.match(floatingButton, /min-h-11/);
  assert.match(floatingButton, /right-4/);
  assert.match(floatingButton, /z-\[200\]/);
  assert.match(floatingButton, /bg-modalBackground/);
  assert.match(floatingButton, /shadow-customshadow-2/);
  assert.match(
    floatingButton,
    /calc\(var\(--mobile-dock-h, 0px\) \+ 16px \+ env\(safe-area-inset-bottom\)\)/,
  );
});
