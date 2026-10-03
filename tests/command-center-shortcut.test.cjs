const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(__dirname, "../src") },
});

const { shouldRenderGlobalCommandMenu, isCommandCenterShortcut } = jiti(
  path.join(__dirname, "../src/lib/constants/commandCenterShortcut.ts"),
);

const shortcut = (overrides = {}) => ({
  altKey: false,
  code: "KeyK",
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  ...overrides,
});

test("Ctrl+K opens the Command Center from boards and task detail", () => {
  assert.equal(isCommandCenterShortcut(shortcut(), false, "/project"), true);
  assert.equal(isCommandCenterShortcut(shortcut(), false, "/project/15"), true);
  assert.equal(
    isCommandCenterShortcut(shortcut(), false, "/detail/project-15/5057"),
    true,
  );
});

test("Ctrl+K stays global on agent, settings, and Page routes", () => {
  assert.equal(isCommandCenterShortcut(shortcut(), false, "/agents"), true);
  assert.equal(
    isCommandCenterShortcut(shortcut(), false, "/agents/ht-bug-fixer"),
    true,
  );
  assert.equal(
    isCommandCenterShortcut(shortcut(), false, "/agents/chat"),
    true,
  );
  assert.equal(isCommandCenterShortcut(shortcut(), false, "/settings"), true);
  assert.equal(
    isCommandCenterShortcut(shortcut(), false, "/settings/shortcuts"),
    true,
  );
  assert.equal(
    isCommandCenterShortcut(shortcut(), false, "/page/page-public-id"),
    true,
  );
  for (const pathname of ["/pages", "/inbox", "/my-tasks", "/time", "/drafts", "/snippets", "/chat", "/trash/15", "/admin/flags", "/integrations"]) {
    assert.equal(isCommandCenterShortcut(shortcut(), false, pathname), true, pathname);
  }
});

test("the signed-in shell renders the Command Center where no route host exists", () => {
  for (const pathname of ["/agents", "/agents/chat", "/agents/ht-bug-fixer", "/settings/profile", "/pages", "/chat", "/my-tasks"]) {
    assert.equal(shouldRenderGlobalCommandMenu(pathname), true, pathname);
  }
  for (const pathname of ["/project", "/detail/project-15/6871", "/inbox", "/page/abc", "/search", "/report"]) {
    assert.equal(shouldRenderGlobalCommandMenu(pathname), false, pathname);
  }

  const provider = fs.readFileSync(
    path.join(
      __dirname,
      "../src/components/ProviderGlobal/GloablProviders.tsx",
    ),
    "utf8",
  );
  assert.match(
    provider,
    /showCommands\.show\s*&&\s*shouldRenderGlobalCommandMenu\(pathname\)\s*&&\s*\(?\s*<HypertasksCommands \/>/,
  );
});

test("Cmd+K is accepted on Apple devices on supported routes", () => {
  const commandK = shortcut({ ctrlKey: false, metaKey: true });
  assert.equal(
    isCommandCenterShortcut(commandK, true, "/detail/project-15/5057"),
    true,
  );
  assert.equal(
    isCommandCenterShortcut(commandK, true, "/page/page-public-id"),
    true,
  );
  assert.equal(isCommandCenterShortcut(commandK, true, "/inbox"), true);
  assert.equal(isCommandCenterShortcut(commandK, false, "/project"), false);
});

test("the command shortcut is not restricted by the route allowlist for other shortcuts", () => {
  for (const pathname of ["/time", "/drafts", "/snippets", "/integrations"]) {
    assert.equal(isCommandCenterShortcut(shortcut(), false, pathname), true);
    assert.equal(shouldRenderGlobalCommandMenu(pathname), true);
  }
  assert.equal(isCommandCenterShortcut(shortcut(), false, null), false);
  assert.equal(shouldRenderGlobalCommandMenu(null), false);
});

test("modified and unrelated keys do not trigger the Command Center", () => {
  assert.equal(
    isCommandCenterShortcut(shortcut({ shiftKey: true }), false, "/project"),
    false,
  );
  assert.equal(
    isCommandCenterShortcut(shortcut({ altKey: true }), false, "/project"),
    false,
  );
  assert.equal(
    isCommandCenterShortcut(shortcut({ code: "KeyJ" }), false, "/project"),
    false,
  );
});

const publicRoutes = [
  "/login", "/qa/login", "/invite", "/reset", "/pricing", "/oauth", "/cli-auth", "/share",
  "/verify-email", "/trial", "/trial-plan-confirmation", "/full-plan-confirmation",
  "/unauthorized", "/onboarding", "/interactive-onboarding", "/new", "/learn", "/demo",
];

for (const route of publicRoutes) {
  test(`${route} and its subroutes keep the browser's Ctrl/Cmd+K default`, () => {
    for (const pathname of [route, `${route}/child`]) {
      assert.equal(isCommandCenterShortcut(shortcut(), false, pathname), false);
      assert.equal(isCommandCenterShortcut(shortcut({ ctrlKey: false, metaKey: true }), true, pathname), false);
      assert.equal(shouldRenderGlobalCommandMenu(pathname), false);
    }
    assert.equal(isCommandCenterShortcut(shortcut(), false, `${route}-workspace`), true);
    assert.equal(shouldRenderGlobalCommandMenu(`${route}-workspace`), true);
  });
}

test("only the global capture handler owns command shortcut toggling", () => {
  const provider = fs.readFileSync(path.join(__dirname, "../src/components/ProviderGlobal/GloablProviders.tsx"), "utf8");
  const hook = fs.readFileSync(path.join(__dirname, "../src/hooks/General/useCommandCenterShortcut.ts"), "utf8");
  assert.match(provider, /import \{ useCommandCenterShortcut \} from "@\/hooks\/General\/useCommandCenterShortcut"/);
  assert.match(provider, /useCommandCenterShortcut\(\s*authenticatedUserId,\s*isApple,\s*pathname,\s*showTrialModal,\s*showEmailVerificationModal,\s*toggleShowCommands,\s*\)/);
  assert.equal((hook.match(/isCommandCenterShortcut\(e, isApple, pathname\)/g) || []).length, 1);
  assert.match(hook, /addEventListener\("keydown", handleCommandCenterShortcut, true\)/);
  assert.match(hook, /removeEventListener\("keydown", handleCommandCenterShortcut, true\)/);
  assert.match(hook, /if \(!isCommandCenterShortcut\(e, isApple, pathname\)\) return;\s*e\.preventDefault\(\);[\s\S]*?e\.stopImmediatePropagation\(\);\s*toggleShowCommands\(\);/);
});
