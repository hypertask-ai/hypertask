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

test("the shared mobile stack exposes icon-only create and AI actions", () => {
  assert.equal(
    (button.match(/<MobileFloatingActionButton/g) ?? []).length,
    2,
  );
  assert.match(button, /ariaLabel="Create task"/);
  assert.match(button, /ariaLabel="Ask AI"/);
  assert.doesNotMatch(button, /label=/);
  assert.match(button, /<Plus[^>]*aria-hidden="true"/);
  assert.match(button, /<Sparkles[^>]*aria-hidden="true"/);
  assert.match(
    button,
    /onClick=\{\(\) =>\s*setCreateTaskModal\(\{\s*show:\s*true,\s*defaultEditFocus:\s*\{\s*defaultEditMode:\s*"Description-ai",\s*defaultFocus:\s*"Description",\s*\},\s*\}\)\s*\}/,
  );
  assert.match(button, /onClick=\{openAIChatInterface\}/);
});

test("the shared stack keeps the AI circle smaller and 12px above the primary", () => {
  assert.match(button, /size="secondary"/);
  assert.match(button, /stackOffset=\{60\}/);
  assert.equal(
    (button.match(/bottomOffset=\{bottomOffset\}/g) ?? []).length,
    2,
  );
  assert.match(floatingButton, /size\?: "primary" \| "secondary"/);
  assert.match(floatingButton, /size === "secondary" \? "h-10 w-10" : "h-12 w-12"/);
  assert.match(floatingButton, /stackOffset\?: number/);
  assert.match(
    floatingButton,
    /transform: stackOffset > 0 \? `translateY\(-\$\{stackOffset\}px\)` : undefined/,
  );
});

test("the shared floating action is an accessible icon-only circle", () => {
  assert.match(floatingButton, /type="button"/);
  assert.match(floatingButton, /aria-label=\{ariaLabel\}/);
  assert.match(floatingButton, /\{icon\}/);
  assert.doesNotMatch(floatingButton, /<span>/);
  assert.doesNotMatch(floatingButton, /label: string/);
  assert.match(floatingButton, /onClick=\{onClick\}/);
  assert.match(floatingButton, /h-12 w-12/);
  assert.match(floatingButton, /justify-center/);
  assert.match(floatingButton, /rounded-full/);
  assert.match(floatingButton, /right-4/);
  assert.match(floatingButton, /z-\[200\]/);
  assert.match(floatingButton, /bg-modalBackground/);
  assert.match(floatingButton, /shadow-customshadow-2/);
});

test("the shared floating action accepts a measured bottom offset and otherwise clears the dock", () => {
  assert.match(floatingButton, /bottomOffset\?: number/);
  assert.match(
    floatingButton,
    /calc\(var\(--mobile-dock-h, 0px\) \+ 16px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(floatingButton, /`calc\(\$\{bottomOffset\}px \+ 16px\)`/);
});
