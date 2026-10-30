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

function gatedValue(file, name, bindings, extraNames = [], flagName) {
  const { source, declaration } = initializer(file, name);
  const names = new Set([name, ...extraNames]);
  const statements = declaration.parent.parent.parent.statements.filter((node) =>
    (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.has(item.name.getText(source)))) ||
    (ts.isIfStatement(node) && node.expression.getText(source) === flagName)
  );
  return evaluate(`(() => { ${statements.map((node) => node.getText(source)).join("\n")} return ${name}; })()`, bindings);
}

function groups(showHistory, roundedEnabled = false, isMobile = false, kanbanSelectAllEnabled, removeImageGeneration = false) {
  const getCommands = gatedValue(palette, "getCommands", {
    getAllCommands, useCallback: (callback) => callback, roundedEnabled, isMobile, keepAiChatClosedKeywords: "", aiChatAutoOpenCommandName: "", blockerCommentEnabled: false, shareKeyLabels: false, removeImageGeneration,
  }, ["getRoundedCommands", "getLegacyCommands"], "roundedEnabled");
  return getCommands({ context: "Task", kanbanSelectAllEnabled, taskOptions: { showHistory, isKanban: false } });
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

for (const roundedEnabled of [false, true]) {
  for (const isMobile of [false, true]) {
    for (const shown of [false, true]) {
      test(`rounded ${roundedEnabled}, mobile ${isMobile}, log ${shown ? "shown" : "hidden"}: name, aliases and shortcut`, () => {
        const commandGroups = groups(shown, roundedEnabled, isMobile);
        const matches = commandGroups.flatMap((group) => group.commandLists).filter((command) => command.key === "toggleHistory");
        assert.equal(matches.length, 1);
        const command = matches[0];
        assert.equal(command.name, `${shown ? "Hide" : "Show"} agent log`);
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
}

test("the palette memoizes the registry and keeps selection and theme arguments independent", () => {
  const memo = initializer(palette, "allCommands_");
  assert.match(memo.text, /getCommands\(\{[\s\S]*?\.\.\.contextOptions,/);
  assert.ok(memo.declaration.initializer.arguments[1].elements.some((node) => node.getText(memo.source) === "getCommands"));
  for (const roundedEnabled of [false, true]) {
    for (const isMobile of [false, true]) {
      for (const kanbanSelectAllEnabled of [false, true]) {
        const commandGroups = groups(false, roundedEnabled, isMobile, kanbanSelectAllEnabled);
        const commands = commandGroups.flatMap((group) => group.commandLists);
        assert.equal(commands.some((command) => command.key === "roundedTheme"), roundedEnabled && !isMobile);
        assert.deepEqual(commandGroups, getAllCommands(
          { context: "Task", kanbanSelectAllEnabled, taskOptions: { showHistory: false, isKanban: false } },
          kanbanSelectAllEnabled,
          roundedEnabled && !isMobile,
        ));
      }
    }
  }
  const command = getAllCommands({ context: "Task" }).flatMap((group) => group.commandLists).find((item) => item.key === "toggleHistory");
  assert.equal(command.name, "Show agent log");
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

test("both shortcut-help surfaces always name the agent log and preserve Windows and Apple keys", () => {
  for (const [file, dataName] of [
    ["src/components/Modals/Settings/ShortcutsSection.tsx", "shortcutGroups"],
    ["src/components/sidebars/keyboardShortcuts.tsx", "mainData"],
  ]) {
    const historyToggleLabel = evaluate(initializer(file, "historyToggleLabel").text, {});
    assert.equal(historyToggleLabel, "Toggle agent log");
    for (const isApple of [false, true]) {
      const shortcuts = evaluate(initializer(file, dataName).text, {
        getKeyboardShortcuts, isApple, appShellRailOn: false,
        historyToggleLabel,
        includeComposeTaskShortcut: false, newTaskWindow: false,
      });
      const shortcut = shortcuts.flatMap((group) => group.sub).find((item) => item.pressKey.join(" ") === `${isApple ? "CMD" : "CTRL"} SHIFT H`);
      assert.equal(shortcut.shortTitle, "Toggle agent log");
    }
  }
  assert.match(initializer("src/components/sidebars/keyboardShortcuts.tsx", "filteredShortcuts").text, /^mainData\s*\.map/);
});


test("New Task shortcut label requires both task writer flags", () => {
  for (const compose of [false, true]) for (const window of [false, true]) {
    const titles = getKeyboardShortcuts(false, false, "Toggle history events", compose, compose && window)
      .flatMap((group) => group.sub).filter((item) => item.pressKey.join(" ") === "CTRL J").map((item) => item.shortTitle);
    assert.deepEqual(titles, compose ? [window ? "New Task" : "Compose task"] : ["Add task with AI Task Writer", "Write with AI"]);
  }
});

test("shared commands default to showing image settings", () => {
  for (const removeImageGeneration of [undefined, false, true]) {
    const commands = getAllCommands(undefined, undefined, false, "", "", false, false, removeImageGeneration)
      .flatMap((group) => group.commandLists);
    assert.equal(commands.some((command) => command.key === "settingsAiFeaturesImageGeneration"), !removeImageGeneration);
  }
});

test("image settings command follows removal in both palette modes", () => {
  for (const roundedEnabled of [false, true]) {
    for (const removeImageGeneration of [false, true]) {
      const commands = groups(false, roundedEnabled, false, false, removeImageGeneration)
        .flatMap((group) => group.commandLists);
      assert.equal(commands.some((command) => command.key === "settingsAiFeaturesImageGeneration"), !removeImageGeneration);
    }
  }
});

test("stale image results are hidden and cannot dispatch when removal turns on", () => {
  const source = ts.createSourceFile(palette, read(palette), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let displayed, dispatch;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "filterCommands") displayed = node.initializer.expression.getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "updateCommandFrequency") dispatch = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(displayed);
  assert.ok(dispatch);
  const image = { key: "settingsAiFeaturesImageGeneration" };
  const other = { key: "other" };
  const myTasks = { key: "myTasksSort" };
  const filterCommands = [{ commandLists: [image, other, myTasks] }];
  for (const removeImageGeneration of [false, true]) for (const onMyTasks of [false, true]) {
    const visible = evaluate(displayed, { filterCommands, removeImageGeneration, onMyTasks })[0].commandLists;
    assert.deepEqual(visible, [...(!removeImageGeneration ? [image] : []), other, ...(onMyTasks ? [myTasks] : [])]);
    const called = [];
    const run = evaluate(dispatch, {
      writing: false, removeImageGeneration, filterCommands,
      findCommandPosition: (groups, command) => groups.some((group) => group.commandLists.includes(command)),
      isDemo: false, isInteractive: true, callback: (command) => called.push(command),
    });
    run(image);
    run(other);
    assert.deepEqual(called, [...(!removeImageGeneration ? [image] : []), other]);
  }
});
