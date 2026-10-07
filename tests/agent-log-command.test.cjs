const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { getAllCommands } = jiti(path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"));
const { getKeyboardShortcuts } = jiti(path.join(root, "src/lib/constants/shortcuts.ts"));
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const { HTPR_6662_AGENT_LOG_NAME_FLAG } = jiti(path.join(root, "src/lib/flags/keys.ts"));
const palette = "src/components/Modals/commands/HTC/commands.tsx";

function initializer(file, name) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found?.initializer, `Missing production initializer: ${name}`);
  return { source, declaration: found, text: found.initializer.getText(source) };
}

function evaluate(text, bindings) {
  const js = ts.transpileModule(`const result = (${text});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return result;`)(...Object.values(bindings));
}

function gatedValue(file, name, bindings, extraNames = [], flagName = "agentLogNameEnabled") {
  const { source, declaration } = initializer(file, name);
  const names = new Set([name, ...extraNames]);
  const statements = declaration.parent.parent.parent.statements.filter((node) =>
    (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.has(item.name.getText(source)))) ||
    (ts.isIfStatement(node) && node.expression.getText(source) === flagName)
  );
  return evaluate(`(() => { ${statements.map((node) => node.getText(source)).join("\n")} return ${name}; })()`, bindings);
}

function groups(enabled, showHistory) {
  const getCommands = gatedValue(palette, "getCommands", {
    getAllCommands, useCallback: (callback) => callback, agentLogNameEnabled: enabled,
  }, ["getAgentLogCommands"]);
  return getCommands({ context: "Task", taskOptions: { showHistory, isKanban: false } });
}

// Run the real search hook with inert React/state dependencies.
function searchCommands(commandGroups, query) {
  let result;
  const js = ts.transpileModule(read("src/hooks/MultiPages/HTC/useHTC.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((specifier) => {
    if (specifier === "react") return {
      useCallback: (callback) => callback, useEffect: () => {},
      useState: (initial) => [initial, (value) => { result = value; }],
    };
    if (specifier === "@/lib/state") return { useRecoilState: () => [{}] };
    if (specifier === "@/store") return {};
    if (specifier === "@/utils/getCurrentUser") return { getCurrentUserFromCookies: () => ({ id: 6 }) };
    if (specifier.startsWith("@/")) return jiti(path.join(root, "src", specifier.slice(2)));
    throw new Error(`Unexpected import: ${specifier}`);
  }, exports);
  exports.default(commandGroups).onKeyChange({ target: { value: query } });
  return result.flatMap((group) => group.commandLists);
}

for (const enabled of [false, true]) {
  for (const shown of [false, true]) {
    test(`flag ${enabled ? "on" : "off"}, log ${shown ? "shown" : "hidden"}: name, aliases and shortcut`, () => {
      const commandGroups = groups(enabled, shown);
      const matches = commandGroups.flatMap((group) => group.commandLists).filter((command) => command.key === "toggleHistory");
      assert.equal(matches.length, 1);
      const command = matches[0];
      assert.equal(command.name, `${shown ? "Hide" : "Show"} ${enabled ? "agent log" : "history"}`);
      assert.equal(command.commandMode, CommandMode.ToggleHistory);
      assert.deepEqual(command.keyboard, ["CTRL", "SHIFT", "H"]);
      assert.ok(command.keywords.includes("agent log agent entries"));
      for (const keyword of ["history", "activity", "log"]) assert.ok(command.keywords.split(" ").includes(keyword));
      for (const query of ["agent log", "AGENT LOG", "agent entries", "history", "activity", "log"]) {
        assert.ok(searchCommands(commandGroups, query).some((match) => match.key === command.key), `Missing result for ${query}`);
      }
    });
  }
}

test("the palette calls the flag in its component body and passes it through the memoized registry", () => {
  assert.equal(HTPR_6662_AGENT_LOG_NAME_FLAG, "htpr-6662-agent-log-name");
  const hook = initializer(palette, "agentLogNameEnabled");
  assert.equal(hook.text, "useFlag(HTPR_6662_AGENT_LOG_NAME_FLAG)");
  const block = hook.declaration.parent.parent.parent;
  assert.ok(ts.isBlock(block) && ts.isArrowFunction(block.parent));
  assert.equal(block.parent.parent.name.getText(hook.source), "Commands");
  const memo = initializer(palette, "allCommands_");
  assert.match(memo.text, /getCommands\(\{[\s\S]*?\.\.\.contextOptions,/);
  assert.ok(memo.declaration.initializer.arguments[1].elements.some((node) => node.getText(memo.source) === "getCommands"));
  assert.deepEqual(getAllCommands({ context: "Task" }), getAllCommands({ context: "Task" }, false));
});

test("both shortcut-help surfaces advertise only the active Ctrl/Cmd+J action", () => {
  for (const [file, dataName] of [
    ["src/components/Modals/Settings/ShortcutsSection.tsx", "shortcutGroups"],
    ["src/components/sidebars/keyboardShortcuts.tsx", "mainData"],
  ]) {
    for (const enabled of [false, true]) {
      const includeComposeTaskShortcut = gatedValue(file, "includeComposeTaskShortcut", { composeTaskWriterEnabled: enabled }, [], "composeTaskWriterEnabled");
      for (const isApple of [false, true]) {
        const shortcuts = evaluate(initializer(file, dataName).text, {
          getKeyboardShortcuts, isApple, appShellRailOn: false,
          consistentCommentShortcuts: false,
          historyToggleLabel: "Toggle history events", includeComposeTaskShortcut, newTaskWindow: false,
        });
        const titles = shortcuts.flatMap((group) => group.sub)
          .filter((item) => item.pressKey.join(" ") === `${isApple ? "CMD" : "CTRL"} J`)
          .map((item) => item.shortTitle);
        assert.deepEqual(titles, enabled ? ["Compose task"] : ["Add task with AI Task Writer", "Write with AI"]);
      }
    }
  }
});

test("both shortcut-help surfaces follow the flag and preserve Windows and Apple keys", () => {
  for (const [file, dataName] of [
    ["src/components/Modals/Settings/ShortcutsSection.tsx", "shortcutGroups"],
    ["src/components/sidebars/keyboardShortcuts.tsx", "mainData"],
  ]) {
    assert.equal(initializer(file, "agentLogNameEnabled").text, "useFlag(HTPR_6662_AGENT_LOG_NAME_FLAG)");
    for (const enabled of [false, true]) {
      const historyToggleLabel = gatedValue(file, "historyToggleLabel", { agentLogNameEnabled: enabled });
      assert.equal(historyToggleLabel, enabled ? "Toggle agent log" : "Toggle history events");
      for (const isApple of [false, true]) {
        const shortcuts = evaluate(initializer(file, dataName).text, {
          getKeyboardShortcuts, isApple, appShellRailOn: false,
          consistentCommentShortcuts: false, historyToggleLabel,
          includeComposeTaskShortcut: false, newTaskWindow: false,
        });
        const shortcut = shortcuts.flatMap((group) => group.sub).find((item) => item.pressKey.join(" ") === `${isApple ? "CMD" : "CTRL"} SHIFT H`);
        assert.equal(shortcut.shortTitle, historyToggleLabel);
      }
    }
  }
  assert.match(initializer("src/components/sidebars/keyboardShortcuts.tsx", "filteredShortcuts").text, /^mainData\s*\.map/);
  assert.ok(getKeyboardShortcuts(false).flatMap((group) => group.sub).some((item) => item.shortTitle === "Toggle history events"));
});


test("New Task shortcut label requires both task writer flags", () => {
  for (const compose of [false, true]) for (const window of [false, true]) {
    const titles = getKeyboardShortcuts(false, false, false, "Toggle history events", compose, compose && window)
      .flatMap((group) => group.sub).filter((item) => item.pressKey.join(" ") === "CTRL J").map((item) => item.shortTitle);
    assert.deepEqual(titles, compose ? [window ? "New Task" : "Compose task"] : ["Add task with AI Task Writer", "Write with AI"]);
  }
});
