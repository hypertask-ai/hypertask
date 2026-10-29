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

const commandMode = new Proxy({}, {
  get: (_target, name) => (typeof name === "string" ? name : undefined),
});
const emptyModule = {};

const { shareTaskShortcutKeys } = loadSource("src/lib/shortcuts/shareTaskShortcuts.ts", {
  "@/lib/constants/keyboard-handler": { KeyCodes: {} },
});
const { getKeyboardShortcuts } = loadSource("src/lib/constants/shortcuts.ts", {
  "@/lib/constants/railToggleKey": loadSource("src/lib/constants/railToggleKey.ts"),
});
const { getTaskCommands } = loadSource("src/components/Modals/commands/HTC/taskCommands.ts", {
  "@/models/enums": { CommandMode: commandMode },
  "@/models/model": emptyModule,
  "./HTCTypes": emptyModule,
  "@/lib/shortcuts/shareTaskShortcuts": { shareTaskShortcutKeys },
});

const shareRows = {
  copyformattedTaskLink: {
    id: "privateFormatted",
    title: "Private share link (Title + URL)",
    legacyLabels: ["CTRL", ":"],
  },
  copyLink: {
    id: "privateUrl",
    title: "Private share link (URL only)",
    legacyLabels: ["CTRL", "SHIFT", ":"],
  },
  copypublicformattedTaskLink: {
    id: "publicFormatted",
    title: "Public share link (Title + URL)",
    legacyLabels: ["CTRL", "."],
  },
  copyPublicLink: {
    id: "publicUrl",
    title: "Public share link (URL only)",
    legacyLabels: ["CTRL", "SHIFT", "."],
  },
};

const paletteRows = (shareKeyLabels) => {
  const rows = getTaskCommands({ context: "Task", taskOptions: {} }, shareKeyLabels).commandLists;
  assert.ok(Array.isArray(rows) && rows.length > 0);
  return new Map(rows.map((row) => [row.key, row]));
};

test("the palette names every share action the keys the handler, the tooltips and the help list name", () => {
  const rows = paletteRows(true);
  const helpEntries = getKeyboardShortcuts(false).flatMap((group) => group.sub);
  for (const [key, row] of Object.entries(shareRows)) {
    const paletteRow = rows.get(key);
    assert.ok(paletteRow, key);
    assert.deepEqual(paletteRow.keyboard, shareTaskShortcutKeys(row.id, false), key);
    const help = helpEntries.filter((entry) => entry.shortTitle === row.title);
    assert.equal(help.length, 1, row.title);
    assert.deepEqual(paletteRow.keyboard, help[0].pressKey, row.title);
  }
});

test("switching the flag off keeps today's palette labels", () => {
  const rows = paletteRows(false);
  for (const [key, row] of Object.entries(shareRows)) {
    assert.deepEqual(rows.get(key).keyboard, row.legacyLabels, key);
  }
  assert.notDeepEqual(
    paletteRows(true).get("copyLink").keyboard,
    paletteRows(false).get("copyLink").keyboard
  );
});

test("no other palette row changes its keys when the flag is on", () => {
  const on = paletteRows(true);
  const off = paletteRows(false);
  assert.deepEqual([...on.keys()], [...off.keys()]);
  for (const [key, row] of on) {
    if (Object.hasOwn(shareRows, key)) continue;
    assert.deepEqual(row.keyboard, off.get(key).keyboard, key);
  }
});

test("the palette reads the share keys from the shared shortcut module", () => {
  const source = read("src/components/Modals/commands/HTC/taskCommands.ts");
  for (const { id } of Object.values(shareRows)) {
    assert.match(source, new RegExp(`shareKeys\\("${id}", \\[`));
  }
  const allCommands = read("src/components/Modals/commands/HTC/AllCommands.ts");
  assert.match(allCommands, /getTaskCommands\(commandOptions, shareKeyLabels\)/);
});
