const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jiti = require("jiti")(__filename);

const {
  areGlobalShortcutsEnabled,
  isGlobalCreateTaskShortcut,
  isGlobalCreateTaskShortcutEnabled,
} = jiti(path.join(__dirname, "../src/lib/keyboard/globalShortcutRoutes.ts"));

test("global shortcuts stay enabled on agent and settings pages", () => {
  for (const pathname of [
    "/agents",
    "/agents/ht-bug-fixer",
    "/settings",
    "/settings/shortcuts",
  ]) {
    assert.equal(areGlobalShortcutsEnabled(pathname), true, pathname);
  }
});

test("C opens task creation from agent and settings pages", () => {
  for (const pathname of [
    "/agents",
    "/agents/ht-bug-fixer",
    "/settings",
    "/settings/general",
  ]) {
    assert.equal(
      isGlobalCreateTaskShortcut(
        {
          code: "KeyC",
          key: "c",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        },
        pathname,
      ),
      true,
      pathname,
    );
  }

  assert.equal(
    isGlobalCreateTaskShortcut(
      {
        code: "",
        key: "C",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
      "/agents",
    ),
    true,
    "legacy event without code",
  );
});

test("modified C presses remain available to their platform shortcuts", () => {
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(
      isGlobalCreateTaskShortcut(
        {
          code: "KeyC",
          key: "c",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          [modifier]: true,
        },
        "/agents",
      ),
      false,
      modifier,
    );
  }
});

test("global shortcuts remain blocked on isolated public and setup routes", () => {
  for (const pathname of [
    "/interactive-onboarding",
    "/learn",
    "/share/public-task",
    "/new",
  ]) {
    assert.equal(areGlobalShortcutsEnabled(pathname), false, pathname);
  }

  for (const pathname of [
    "/login",
    "/project",
    "/detail/project-15/5607",
    "/inbox",
    "/calendar",
  ]) {
    assert.equal(isGlobalCreateTaskShortcutEnabled(pathname), false, pathname);
  }
});

test("the signed-in provider owns one app-shell shortcut listener", () => {
  const read = (relativePath) =>
    fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

  assert.match(
    read("src/components/ProviderGlobal/GloablProviders.tsx"),
    /useAppShellSurfaceShortcuts\(\);/,
  );
  assert.match(
    read(
      "src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx",
    ),
    /useAppShellSurfaceShortcuts\(\{ listen: false \}\)/,
  );
  assert.match(
    read("src/components/Global/MobileTabBar.tsx"),
    /useAppShellSurfaceShortcuts\(\{ listen: false \}\)/,
  );
});
