const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const commandPath = "src/components/Modals/commands/HTC/AllCommands.ts";
const calendarPath = "src/hooks/Calendar/useCalendarKeyboard.ts";

function load(file, dependencies = {}) {
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", javascript)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    const resolved = name.startsWith("@/") ? `src/${name.slice(2)}` : path.join(path.dirname(file), name);
    if (!name.startsWith("@/") && !name.startsWith(".")) throw new Error(`Unstubbed dependency: ${name}`);
    return load(`${resolved}.ts`, dependencies);
  }, exports);
  return exports;
}

const { KeyCodes } = load("src/lib/constants/keyboard-handler.ts");
const { createGlobalGShortcutCapture } = load("src/lib/keyboard/globalGShortcuts.ts");
const { getKeyboardShortcuts } = load("src/lib/constants/shortcuts.ts");
const { getAllCommands } = load(commandPath);
const names = new Map(Object.entries(KeyCodes).map(([name, code]) => [code, name]));
const aliases = { ARROW_LEFT: "←", ARROW_RIGHT: "→", ARROW_UP: "⭡", ARROW_DOWN: "⭣", ESCAPE: "ESC", SEMICOLON: ";", OPEN_BRACKET: "[", CLOSE_BRACKET: "]", BACKTICK: "`", THREE: "3" };

function keyParts(code, modifiers) {
  if (code === KeyCodes.THREE && modifiers.shiftKey) return ["#"];
  const parts = [];
  for (const [property, display] of [["ctrlKey", "CTRL"], ["metaKey", "CMD"], ["altKey", "ALT"], ["shiftKey", "SHIFT"]]) {
    if (modifiers[property]) parts.push(display);
  }
  const name = names.get(code);
  return [...parts, aliases[name] ?? name];
}

const navigationHelp = {
  Board: "Go to task board", "Inbox Archive": "Go to inbox archives", Timers: "Go to running timers",
  Reminders: "Go to reminders", Trash: "Go to trash", "All Tasks": "Go to all tasks", "My Tasks": "Go to my tasks",
  Inbox: "Go to inbox", Snippets: "Go to snippets", "Task Archive": "Go to archived tasks", Starred: "Go to starred",
  Pinned: "Go to pinned", Drafts: "Go to drafts", Scheduled: "Go to scheduled tasks", Calendar: "Go to calendar",
};
const navigationCommands = {
  Board: "appShellBoard", "Inbox Archive": "GotoInboxArchive", Timers: "GoToTimers", Reminders: "GotoReminders",
  Trash: "GoToTrash", "All Tasks": "GoToAllTasks", "My Tasks": "GoToMyTasks", Inbox: "GotoInbox",
  Snippets: "GotoSnippets", "Task Archive": "GotoTaskArchived", Starred: "GoToStarred", Pinned: "GoToPinned",
  Drafts: "GoToDrafts", Scheduled: "GoToDueDates", Calendar: "GoToCalender",
};
const calendarHelp = {
  create: "Add task", due: "Update due date", next: "Next month/week", previous: "Previous month/week",
  month: "Month view", week: "Week view", day: "Day view", today: "Focus on today",
  "focus:right": "Focus on next day", "focus:left": "Focus on yesterday", filter: "Filter tasks",
  "project:toggle": "Select project from filters", "project:focus": "Toggle through project filters", "save-view": "Save calendar view",
};
const calendarCommands = { create: "createTask", due: "setDueDate", filter: "ShowFilterHtc" };
const inheritedHelp = { "Move focus down": "focus:down", "Move focus up": "focus:up", "Exit (go back)": "back" };

function analyze({ bindings, help, commands }) {
  const findings = [];
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  for (const binding of bindings) {
    if (!help.some((row) => row.scope === binding.scope && row.action === binding.action && equal(row.keys, binding.keys))) {
      findings.push({ category: "binding-missing-help", ...binding });
    }
    if (!commands.some((command) => command.key === binding.command) && !findings.some((finding) => finding.category === "action-missing-command" && finding.scope === binding.scope && finding.action === binding.action)) {
      findings.push({ category: "action-missing-command", ...binding });
    }
  }
  for (const row of help) {
    if (!bindings.some((binding) => binding.scope === row.scope && binding.action === row.action && equal(binding.keys, row.keys))) {
      findings.push({ category: "help-without-binding", ...row });
    }
  }
  const grouped = new Map();
  for (const binding of bindings) {
    const id = JSON.stringify([binding.scope, binding.keys]);
    grouped.set(id, [...(grouped.get(id) ?? []), binding.action]);
  }
  for (const [id, actions] of grouped) {
    if (new Set(actions).size < 2) continue;
    const [scope, keys] = JSON.parse(id);
    findings.push({ category: "duplicate-keys", scope, keys, actions: [...new Set(actions)].sort() });
  }
  return findings.filter((finding, index, all) => all.findIndex((other) => equal(other, finding)) === index);
}

function inventoryPlatform(apple) {
  const dom = new JSDOM("<!doctype html><body><button id='project'>Project</button></body>", { url: "https://shortcuts.test/calendar" });
  dom.window.history.pushState({}, "", "/calendar?previous=1");
  const errors = [];
  dom.window.addEventListener("error", (event) => errors.push(event.error));
  const document = dom.window.document;
  const cleanups = [];
  let actions = [];
  const record = (action) => () => actions.push(action);
  const { useCalendarKeyboard } = load(calendarPath, {
    react: { useCallback: (callback) => callback, useEffect: (effect) => cleanups.push(effect()) },
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
    "@/lib/constants": { gThenKeyDelay: 1000, draftsRoute: "/drafts" },
  });
  const lastGClickRef = { current: null };
  const context = {
    projects: [{ id: 1, name: "project" }], currentDay: new Date("2026-01-01T00:00:00Z"), currentTask: 1,
    lastGClickRef, currentProjectCycleIndexRef: { current: -1 }, goToProjectShortcut: record("task-board"),
    showDueDateModal: { show: false }, showFilterModal: false, setShowFilterModal: record("filter"),
    router: { push: (url) => actions.push(({ "/drafts": "Drafts", "/scheduled": "Scheduled" })[url] ?? `route:${url}`), back: record("back") }, isApple: apple,
    createTaskModal: { show: false }, checkedProjects: {}, setCurrentViewFromInteraction: (view) => actions.push(view),
    tasks: [{ id: 1, projectId: 1 }], FOCUS_MORE_INDICATOR: -2,
    toggleDueDateModal: (mode) => actions.push(mode === "Create" ? "create" : "due"), handleTaskClick: record("open-task"),
    toggleManageTasksModal: record("manage-tasks"), handleDateSelect: record("today"), handleProjectToggle: record("project:toggle"),
    handlePrevious: record("previous"), handleNext: record("next"), shiftFocusHorizontally: (direction) => actions.push(`focus:${direction}`),
    shiftFocusVertically: (direction) => actions.push(`focus:${direction}`), moveTaskHorizontally: (direction) => actions.push(`move:${direction}`),
    moveTaskVertically: (direction) => actions.push(`move:${direction}`),
  };
  const originalDocument = global.document;
  const originalWindow = global.window;
  const originalTimeout = global.setTimeout;
  global.document = document;
  global.window = dom.window;
  global.setTimeout = () => 0;
  const bindings = [];
  const add = (scope, keys, action, source) => {
    const command = navigationCommands[action] ?? calendarCommands[action];
    bindings.push({ scope, keys, action, command: command ?? null, source });
  };
  const dispatch = (code, modifiers = {}) => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    keyCode: code, bubbles: true, cancelable: true, ...modifiers,
  }));
  const capture = createGlobalGShortcutCapture({ delayMs: 1000, onShortcut: (action) => actions.push(action) });
  document.addEventListener("keydown", capture, true);
  try {
    for (const code of new Set(Object.values(KeyCodes))) {
      for (const modifiers of [{}, { shiftKey: true }]) {
        actions = [];
        dispatch(KeyCodes.G);
        dispatch(code, modifiers);
        for (const action of actions) add("Global g", ["G", null, ...keyParts(code, modifiers)], action, "global-g");
      }
    }
    document.removeEventListener("keydown", capture, true);
    document.getElementById("project").addEventListener("focus", record("project:focus"));
    useCalendarKeyboard(context);
    const modifierSets = [{}, { shiftKey: true }, { [apple ? "metaKey" : "ctrlKey"]: true }];
    for (const code of new Set(Object.values(KeyCodes))) {
      for (const modifiers of modifierSets) {
        actions = [];
        lastGClickRef.current = null;
        context.currentProjectCycleIndexRef.current = code === KeyCodes.SPACE ? 0 : -1;
        document.getElementById("project").blur();
        dispatch(code, modifiers);
        for (const action of actions) add("Calendar", keyParts(code, modifiers), action, "calendar");
      }
    }
    for (const code of new Set(Object.values(KeyCodes))) {
      actions = [];
      dispatch(KeyCodes.G);
      dispatch(code);
      if (lastGClickRef.current === null) {
        for (const action of actions) add("Global g", ["G", null, ...keyParts(code, {})], action, "calendar");
      }
    }
    document.addEventListener("keydown", capture, true);
    actions = [];
    dispatch(KeyCodes.G);
    dispatch(KeyCodes.T);
    const composedGT = [...actions];
    const rows = getKeyboardShortcuts(apple, false);
    const help = rows.filter((group) => ["Global Shortcuts", "Calendar"].includes(group.title)).flatMap((group) => group.sub
      .filter((row) => group.title === "Calendar" || Object.hasOwn(inheritedHelp, row.shortTitle) || row.shortTitle === "Move focus" || row.pressKey[0] === "G" && row.pressKey[1] === null && row.pressKey[2] !== "X")
      .flatMap((row) => {
        if (row.shortTitle === "Move focus") return row.pressKey.map((key) => ({
          scope: "Calendar", keys: [key], title: row.shortTitle,
          action: { "←": "focus:left", "→": "focus:right", "⭡": "focus:up", "⭣": "focus:down" }[key],
        }));
        let action = inheritedHelp[row.shortTitle] ?? (group.title === "Calendar" ? Object.keys(calendarHelp).find((key) => calendarHelp[key] === row.shortTitle)
          : Object.keys(navigationHelp).find((key) => navigationHelp[key] === row.shortTitle));
        if (!action) action = `unmapped:${row.shortTitle}`;
        const keySets = row.shortTitle === "Toggle through project filters"
          ? [[row.pressKey[0], "["], [row.pressKey[0], "]"]] : [row.pressKey];
        return keySets.map((keys) => ({ scope: group.title === "Calendar" || Object.hasOwn(inheritedHelp, row.shortTitle) ? "Calendar" : "Global g", keys, action, title: row.shortTitle }));
      }));
    const commands = ["Others", "Task", "Kanban"].flatMap((context) => getAllCommands({ context, appShellRailOn: true }).flatMap((group) => group.commandLists));
    const unique = bindings.filter((binding, index) => bindings.findIndex((other) => JSON.stringify(other) === JSON.stringify(binding)) === index);
    if (errors.length) throw new AggregateError(errors, "Shortcut DOM dispatch failed");
    return { platform: apple ? "Apple" : "Windows", bindings: unique, help, composedGT, findings: analyze({ bindings: unique, help, commands }) };
  } finally {
    for (const cleanup of cleanups) cleanup?.();
    document.removeEventListener("keydown", capture, true);
    dom.window.close();
    global.document = originalDocument;
    global.window = originalWindow;
    global.setTimeout = originalTimeout;
  }
}

function buildInventory() {
  return { mode: "report-only", coverage: "Global-g capture and Calendar hook; not all app handlers", platforms: [inventoryPlatform(false), inventoryPlatform(true)] };
}

function renderReport(inventory) {
  const lines = ["# Shortcut consistency: Unit 1 (report-only)", "", "Ticket: https://app.hypertask.ai/detail/project-4060/676", "",
    "Regenerate: `node scripts/shortcut-drift.cjs --write`. Check snapshot locally: `node scripts/shortcut-drift.cjs --check`.",
    "CI: `tests/shortcut-drift.test.cjs` emits live diagnostics; drift and stale snapshots do not fail CI. Analyzer regressions still fail.", "",
    "## Method and limits", "",
    "Dispatches DOM keydown events through the real global-g capture handler and Calendar hook listener, with React registration and external effects stubbed. Loads real help and Ctrl+K command factories; no source-regex binding extraction. This is not full-app/browser QA.",
    "Global-g: every KeyCodes value, plain and Shift. Calendar: every KeyCodes value, plain, Shift and platform command modifier; also g+plain sequences that consume the prefix; selected-task/no-modal context, one project. Help: rail off, including inherited global focus/exit entries; commands: union of Others/Task/Kanban with rail on (availability superset). Apple and Windows are separate.",
    "Findings are review candidates, not assertions of product intent or proof that an action is unavailable in every dynamically-added palette context.",
    "Action/title and action/command-key crosswalks are explicit audit metadata, not handler definitions. Unknown actions remain diagnostics. Missing-command actions are deduplicated per scope; the first observed key is shown. Calendar modified-key acceptance is reported literally, not endorsed as intended UX. Unvisited contexts, other modifier combinations, route/permission filtering, editor and board handlers remain follow-up.",
    "`Global g` duplicates include the Calendar listener on that page, probed in isolation. Capture precedence is also exercised: g+t reaches Timers only, shadowing Calendar's task-board action. The isolated Calendar g+d listener also opens the due-date modal before navigating to Drafts; capture shadows that listener too. These are competing registrations, not proof of double navigation in the composed app.", "",
    "## Findings", ""];
  for (const platform of inventory.platforms) {
    lines.push(`### ${platform.platform}`, "", `Observed bindings: ${platform.bindings.length}. Composed g+t: ${platform.composedGT.join(", ")}.`, "");
    for (const category of ["binding-missing-help", "help-without-binding", "action-missing-command", "duplicate-keys"]) {
      const findings = platform.findings.filter((finding) => finding.category === category);
      lines.push(`#### ${category} (${findings.length})`, "");
      for (const finding of findings) lines.push(`- ${finding.scope}: ${finding.keys.map((key) => key ?? "then").join(" ")} → ${finding.action ?? finding.actions.join(" / ")}`);
      if (!findings.length) lines.push("- None in covered scope.");
      lines.push("");
    }
  }
  lines.push("## Follow-up (no product changes here)", "", "Decide whether to restore or remove Calendar Shift+V help; reconcile Calendar's shadowed g+t task-board and g+d due-date side effect; decide which local focus/view actions belong in Ctrl+K and whether modifier-permissive bindings are intended. Extend the behavioral harness to board, task detail, app shell, editor, modal, typing and flag contexts before treating this as an exhaustive audit. No flag or key binding is changed by this PR.", "");
  return lines.join("\n");
}

function serializeInventory(inventory) {
  const platforms = inventory.platforms.map((platform) => {
    const fields = Object.entries(platform).map(([key, value]) => {
      if (!Array.isArray(value) || key === "composedGT") return `      ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
      return `      ${JSON.stringify(key)}: [\n${value.map((row) => `        ${JSON.stringify(row)}`).join(",\n")}\n      ]`;
    });
    return `    {\n${fields.join(",\n")}\n    }`;
  });
  return `{\n  "mode": ${JSON.stringify(inventory.mode)},\n  "coverage": ${JSON.stringify(inventory.coverage)},\n  "platforms": [\n${platforms.join(",\n")}\n  ]\n}\n`;
}

module.exports = { analyze, buildInventory, renderReport, serializeInventory };

if (require.main === module) {
  const inventory = buildInventory();
  const artifacts = [["docs/keyboard-shortcut-inventory.json", serializeInventory(inventory)], ["docs/keyboard-shortcut-consistency.md", renderReport(inventory)]];
  for (const [file, content] of artifacts) {
    if (process.argv.includes("--write")) fs.writeFileSync(path.join(root, file), content);
    if (process.argv.includes("--check") && fs.readFileSync(path.join(root, file), "utf8") !== content) throw new Error(`Stale shortcut artifact: ${file}`);
  }
  console.log(renderReport(inventory));
  console.log("shortcut drift artifacts current; report-only");
}
