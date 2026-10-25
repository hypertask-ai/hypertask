const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadSource(file, dependencies = {}) {
  const exports = {};
  const javascript = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("require", "exports", javascript)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name} in ${file}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const { KeyCodes } = loadSource("src/lib/constants/keyboard-handler.ts");
const { SHARE_TASK_SHORTCUTS, shareTaskShortcutFor, shareTaskShortcutKeys } = loadSource(
  "src/lib/shortcuts/shareTaskShortcuts.ts",
  { "@/lib/constants/keyboard-handler": { KeyCodes } }
);
const rail = loadSource("src/lib/constants/railToggleKey.ts");
const { getKeyboardShortcuts } = loadSource("src/lib/constants/shortcuts.ts", {
  "@/lib/constants/railToggleKey": rail,
});
const shortcutIds = ["privateFormatted", "privateUrl", "publicFormatted", "publicUrl"];

const expectedShortcuts = {
  privateFormatted: {
    tooltip: "Copy private link with title",
    apple: ["CMD", ";"],
    other: ["CTRL", ";"],
  },
  privateUrl: {
    tooltip: "Copy private link",
    apple: ["CMD", "SHIFT", ";"],
    other: ["CTRL", "SHIFT", ";"],
  },
  publicFormatted: {
    tooltip: "Copy public link with title",
    apple: ["CMD", "."],
    other: ["CTRL", "."],
  },
  publicUrl: {
    tooltip: "Copy public link",
    apple: ["CMD", "SHIFT", "."],
    other: ["CTRL", "SHIFT", "."],
  },
};

test("share shortcuts preserve the four bindings, comma alias, and rejected combinations", () => {
  for (const [keyCode, shiftKey, cmdControl, expected] of [
    [KeyCodes.SEMICOLON, false, true, "privateFormatted"],
    [KeyCodes.COMMA, false, true, "privateFormatted"],
    [KeyCodes.SEMICOLON, true, true, "privateUrl"],
    [KeyCodes.PERIOD, false, true, "publicFormatted"],
    [KeyCodes.PERIOD, true, true, "publicUrl"],
    [KeyCodes.SEMICOLON, false, false, null],
    [KeyCodes.A, true, true, null],
    [KeyCodes.COMMA, true, true, null],
    [KeyCodes.A, false, true, null],
    [KeyCodes.PERIOD, true, false, null],
  ]) {
    assert.equal(shareTaskShortcutFor({ cmdControl, keyCode, shiftKey }), expected);
  }
});

test("share tooltips expose the exact platform keys and return independent arrays", () => {
  assert.deepEqual(SHARE_TASK_SHORTCUTS, expectedShortcuts);
  for (const isApple of [false, true]) {
    for (const id of shortcutIds) {
      const expected = expectedShortcuts[id][isApple ? "apple" : "other"];
      const keys = shareTaskShortcutKeys(id, isApple);
      assert.deepEqual(keys, expected);
      assert.notStrictEqual(keys, SHARE_TASK_SHORTCUTS[id][isApple ? "apple" : "other"]);
      assert.notStrictEqual(keys, shareTaskShortcutKeys(id, isApple));
      keys.push("changed");
      assert.deepEqual(shareTaskShortcutKeys(id, isApple), expected);
    }
  }
});

test("share tooltip keys match all four cheatsheet entries on both platforms", () => {
  const titles = {
    privateFormatted: "Private share link (Title + URL)",
    privateUrl: "Private share link (URL only)",
    publicFormatted: "Public share link (Title + URL)",
    publicUrl: "Public share link (URL only)",
  };
  for (const isApple of [false, true]) {
    const entries = getKeyboardShortcuts(isApple).flatMap((group) => group.sub);
    for (const id of shortcutIds) {
      const matches = entries.filter((entry) => entry.shortTitle === titles[id]);
      assert.equal(matches.length, 1, titles[id]);
      assert.deepEqual(matches[0].pressKey, expectedShortcuts[id][isApple ? "apple" : "other"]);
      assert.deepEqual(matches[0].pressKey, shareTaskShortcutKeys(id, isApple));
    }
  }
});

test("all four copy commands show the same CTRL keys as the tooltips", () => {
  const source = read("src/components/Modals/commands/HTC/taskCommands.ts");
  const commands = {
    copyformattedTaskLink: "privateFormatted",
    copyLink: "privateUrl",
    copypublicformattedTaskLink: "publicFormatted",
    copyPublicLink: "publicUrl",
  };
  for (const [command, id] of Object.entries(commands)) {
    const match = source.match(new RegExp(`\\{\\s*key: "${command}",[^{}]*?keyboard: (\\[[^\\]]*\\])`));
    assert.ok(match, `Missing keyboard for ${command}`);
    const keys = JSON.parse(match[1]);
    assert.deepEqual(keys, expectedShortcuts[id].other);
    assert.deepEqual(keys, shareTaskShortcutKeys(id, false));
  }
});

test("desktop ShareSection forwards exactly the four concrete shortcut IDs to row tooltips", () => {
  const source = read("src/components/Modals/ShareTaskModal/index.tsx");
  const sections = [...source.matchAll(/<ShareSection\s[\s\S]*?\n        \/>/g)];
  assert.equal(sections.length, 2);
  const forwardedProps = [...source.matchAll(/shortcutId=\{(shortcutTitle|shortcutUrl)\}/g)]
    .map((match) => match[1]);
  assert.deepEqual(forwardedProps, ["shortcutTitle", "shortcutUrl"]);
  assert.equal([...source.matchAll(/\bshortcutId=/g)].length, 2);
  const rowIds = sections.flatMap(([section]) => forwardedProps.map((prop) => {
    const match = section.match(new RegExp(`\\b${prop}="([^"]+)"`));
    assert.ok(match, `Missing ${prop}`);
    return match[1];
  }));
  assert.deepEqual(rowIds, shortcutIds);
  assert.equal([...source.matchAll(/\bshortcut(?:Title|Url)="/g)].length, 4);
  assert.match(source, /<ShareRow\s+shortcutId=\{shortcutTitle\}\s+label="Title \+ URL"/);
  assert.match(source, /<ShareRow\s+shortcutId=\{shortcutUrl\}\s+label="URL only"/);
  assert.match(source, /const showShortcutTooltips = useFlag\(HTPR_7839_SHARE_SHORTCUT_TOOLTIPS_FLAG\)/);
  assert.match(source, /<div className="flex items-center gap-3 w-full">\s*\{showShortcutTooltips && shortcutId && \(\s*<Tooltip\s+portal\s+left=\{0\}\s+bottom=\{0\}\s+text=\{SHARE_TASK_SHORTCUTS\[shortcutId\]\.tooltip\}\s+keyCombination=\{shareTaskShortcutKeys\(shortcutId, isApple\)\}/);
  assert.match(source, /const shortcutId = shareTaskShortcutFor\(\{\s*cmdControl,\s*keyCode: e\.keyCode,\s*shiftKey: e\.shiftKey,\s*\}\)/);
});
