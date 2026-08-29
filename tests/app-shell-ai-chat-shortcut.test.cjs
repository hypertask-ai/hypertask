const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("] toggles AI chat as a rail-shell synonym without replacing 5", () => {
  const hook = read("src/hooks/Homepage/useAppShellSurfaceShortcuts.ts");
  const shortcuts = read("src/lib/constants/shortcuts.ts");
  const commands = read("src/components/Modals/commands/HTC/AllCommands.ts");
  const registry = read("docs/keyboard-shortcuts-registry.md");

  assert.match(hook, /AI_CHAT_TOGGLE_KEYS[^=]*= \["5", "\]"\]/);
  assert.match(
    hook,
    /AI_CHAT_TOGGLE_KEYS\.includes\(event\.key\)\) toggleAIChatInterface\(\)/
  );
  assert.match(
    shortcuts,
    /Toggle AI chat", pressKey: \["5"\][\s\S]*?Toggle AI chat \(alternative\)", pressKey: \["\]"\]/
  );
  assert.match(
    commands,
    /key: "appShellAIChat"[\s\S]*?keyboard: \["5"\][\s\S]*?key: "appShellAIChatAlternative"[\s\S]*?keyboard: \["\]"\]/
  );
  assert.match(registry, /`5` \/ `\]` \| Toggle AI chat/);
});

test("the AI chat synonyms preserve editable-field and modifier protections", () => {
  const hook = read("src/hooks/Homepage/useAppShellSurfaceShortcuts.ts");
  const shortcuts = read("src/lib/constants/shortcuts.ts");

  assert.match(
    hook,
    /\["INPUT", "TEXTAREA", "SELECT"\]\.includes\(target\.tagName\) \|\|[\s\S]*?target\.isContentEditable/
  );
  assert.match(
    hook,
    /event\.ctrlKey \|\|[\s\S]*?event\.metaKey \|\|[\s\S]*?event\.altKey \|\|[\s\S]*?event\.shiftKey \|\|[\s\S]*?isTypingTarget[\s\S]*?return;/
  );
  assert.match(
    shortcuts,
    /appShellRailOn[\s\S]*?\? \[\][\s\S]*?Next view", pressKey: \["\]"\]/,
    "the old shell must retain its existing ] next-view shortcut"
  );
});
