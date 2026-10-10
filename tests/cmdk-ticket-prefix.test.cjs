const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const flags = jiti(path.join(root, "src/lib/flags/keys.ts"));
const registry = jiti(path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"));
const palette = "src/components/Modals/commands/HTC/commands.tsx";
const prefixKey = "settingsBoardTicketPrefix";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Execute production memo/hook boundaries, not a duplicate search implementation.
function initializer(file, name) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing production boundary: ${name}`);
  return found.getText(source);
}

function evaluate(source, bindings) {
  const js = ts.transpileModule(`const result = (${source});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return result;`)(...Object.values(bindings));
}

function flagBindings(file, enabled) {
  const bindings = { ...flags, useFlag: (key) => enabled && key === flags.HTPR_6868_TICKET_PREFIX_FLAG };
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === "useFlag") {
      result[node.name.getText(source)] = evaluate(node.initializer.getText(source), bindings);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function paletteGroups(enabled, frequent = {}, contextOptions) {
  const bindings = {
    ...registry, ...flagBindings(palette, enabled), CommandMode,
    useMemo: (callback) => callback(),
    boardLayout: "board", calendarSettings: { showWeekends: true },
    currentProject: { id: 15 }, frequentlyUsed: frequent, projects: [],
    contextOptions, appShellRailOn: false, onAgentChat: false, agentChatOwner: false,
    onCalendar: false, onMyTasks: false, isMobile: false, showByokApiKeys: false,
    pinCommentActions: false, pageActions: null,
    getActiveEmptySectionSettingFromProject: () => "Hidden",
    getActiveStalenessFromProject: () => false,
    getHTCFrecencyScore: () => 0,
  };
  const source = ts.createSourceFile(palette, read(palette), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["excludeTicketPrefixCommand", "includeTicketPrefixCommand", "isTicketPrefixCommandVisible"]);
  const statements = [];
  function visit(node) {
    if ((ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => names.has(declaration.name.getText(source)))) ||
        (ts.isIfStatement(node) && node.expression.getText(source) === "ticketPrefixEnabled")) {
      statements.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  bindings.isTicketPrefixCommandVisible = evaluate(`(() => { ${statements.join("\n")} return isTicketPrefixCommandVisible; })()`, {
    ...bindings, useCallback: (callback) => callback,
  });
  bindings.getCommands = registry.getAllCommands;
  return evaluate(initializer(palette, "allCommands_"), bindings);
}

function searchCommands(groups, query) {
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
  exports.default(groups).onKeyChange({ target: { value: query } });
  return result.flatMap((group) => group.commandLists);
}

function prefixResult(enabled, query = "ticket prefix") {
  return searchCommands(paletteGroups(enabled), query).find((command) => command.key === prefixKey);
}

test("retired inbox archives stay absent from palette search and remembered commands", () => {
  const groups = paletteGroups(false, {
    "archiveInboxCluster-10": { frequency: 100, lastUsedAt: Date.now() },
    createTask: { frequency: 1, lastUsedAt: Date.now() },
  }, {
    context: "Others",
    inboxClusters: [{ notificationId: "10", ticketNumber: "HTPR-6905", count: 7 }],
  });
  const commands = groups.flatMap((group) => group.commandLists);
  assert.ok(commands.some(({ key }) => key === "createTask"));
  assert.equal(groups[0].group, "Frequently used");
  assert.ok(commands.every(({ key, name }) => !key.startsWith("archiveInboxCluster-") && !name.startsWith("Archive cluster:")));
  assert.ok(searchCommands(groups, "archive").every(({ name }) => !name.startsWith("Archive cluster:")));
});

test("flag on: ticket prefix search finds the board-general settings command", () => {
  const command = prefixResult(true);
  assert.ok(command, "Ticket prefix command must be searchable");
  assert.equal(command.name, "Settings: Ticket prefix (board)");
  assert.equal(command.commandMode, CommandMode.Setting);
  assert.equal(command.payload, "board-general");
});

test("flag off: ticket prefix is absent from search and remembered commands", () => {
  assert.ok(prefixResult(true), "Positive control must find Ticket prefix");
  assert.equal(prefixResult(false), undefined);
  const groups = paletteGroups(false, { [prefixKey]: { frequency: 100, lastUsedAt: Date.now() } });
  assert.equal(groups.flatMap((group) => group.commandLists).some((command) => command.key === prefixKey), false);
  assert.ok(searchCommands(groups, "time tracking").some((command) => command.key === "settingsBoardGeneral"));
});

test("flag on: Ticket prefix aliases and partial case-insensitive queries are searchable", () => {
  for (const query of ["TICKET PREFIX", "ticket pre", "identifier", "id", "key", "code", "letters", "rename"]) {
    assert.ok(prefixResult(true, query), `Missing Ticket prefix result for ${query}`);
  }
});


test("the command search memo re-evaluates when the Ticket prefix flag changes", () => {
  for (const [file, name, dependency] of [
    [palette, "allCommands_", "isTicketPrefixCommandVisible"],
  ]) {
    const source = ts.createSourceFile(file, initializer(file, name), ts.ScriptTarget.Latest, true);
    const expression = source.statements[0].expression;
    assert.ok(expression.arguments[1].elements.some((element) => element.getText(source) === dependency));
  }
});
