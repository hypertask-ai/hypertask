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

test("the mobile create-task button opens the shared modal and clears the dock", () => {
  assert.match(button, /type="button"/);
  assert.match(button, /aria-label="Create task"/);
  assert.match(button, /setCreateTaskModal\(\{ show: true \}\)/);
  assert.match(button, /<span>New task<\/span>/);
  assert.match(button, /min-h-11/);
  assert.match(button, /right-4/);
  assert.match(button, /z-\[200\]/);
  assert.match(button, /bg-modalBackground/);
  assert.match(button, /shadow-customshadow-2/);
  assert.match(
    button,
    /calc\(var\(--mobile-dock-h, 0px\) \+ 16px \+ env\(safe-area-inset-bottom\)\)/,
  );
});
