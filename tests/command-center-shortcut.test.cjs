const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jiti = require("jiti")(__filename);

const { isAgentsRoute, isCommandCenterShortcut } = jiti(
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
  assert.equal(isCommandCenterShortcut(shortcut(), false, "/pages"), false);
});

test("the signed-in shell renders the Command Center only on agent routes", () => {
  assert.equal(isAgentsRoute("/agents"), true);
  assert.equal(isAgentsRoute("/agents/chat"), true);
  assert.equal(isAgentsRoute("/agents/ht-bug-fixer"), true);
  assert.equal(isAgentsRoute("/agents-old"), false);
  assert.equal(
    isCommandCenterShortcut(shortcut(), false, "/agents-old"),
    false,
  );

  const provider = fs.readFileSync(
    path.join(
      __dirname,
      "../src/components/ProviderGlobal/GloablProviders.tsx",
    ),
    "utf8",
  );
  assert.match(
    provider,
    /showCommands\.show && isAgentsRoute\(pathname\) && <HypertasksCommands \/>/,
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
  assert.equal(isCommandCenterShortcut(commandK, true, "/inbox"), false);
  assert.equal(isCommandCenterShortcut(commandK, false, "/project"), false);
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
