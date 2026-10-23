const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compact = (source) => source.replace(/\s+/g, "");

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
const rail = loadSource("src/lib/constants/railToggleKey.ts");
const helpFile = "src/lib/constants/shortcuts.ts";
const { getKeyboardShortcuts } = loadSource(helpFile, {
  "@/lib/constants/railToggleKey": rail,
});
const { keyboard_shortcuts: shortcuts, matchesShortcut } = loadSource("src/lib/utils/keyboardShortcuts.ts", {
  "@/lib/constants/keyboard-handler": { KeyCodes },
});

const files = {
  global: "src/components/ProviderGlobal/GloablProviders.tsx",
  board: "src/hooks/Homepage/useHandleKeyDownOperations.ts",
  section: "src/hooks/Homepage/useSections.ts",
  row: "src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx",
  edit: "src/app/detail/[...slug]/taskDetailEditingKeymap.ts",
  nav: "src/app/detail/[...slug]/taskDetailNavigationKeymap.ts",
  detail: "src/app/detail/[...slug]/taskDetailKeyboard.ts",
  comments: "src/hooks/Task Detail/CommentAndDescriptionHooks/useCommentAndDescriptions.ts",
  editor: "src/components/RTE/useTaskDetailEditorKeyboard.tsx",
  time: "src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskTime.tsx",
  calendar: "src/hooks/Calendar/useCalendarKeyboard.ts",
  ai: "src/hooks/MultiPages/AIChat/aiChatKeyboard.ts",
  agent: "src/app/agents/chat/useAgentChatComposer.ts",
  cycle: "src/app/agents/chat/useAgentLifecycle.ts",
  views: "src/hooks/Homepage/Views/useViewCyclingShortcuts.ts",
  shell: "src/hooks/Homepage/useAppShellSurfaceShortcuts.ts",
  inbox: "src/components/notifications/inboxSplit/index.tsx",
  bulk: "src/hooks/MultiPages/useBulkActions.ts",
  save: "src/components/RTE/TiptapCreateTaskModal.tsx",
  archived: "src/app/archived/ArchivedTasksComp.tsx",
};
const contracts = new Map();
const normalize = (keys, apple) => keys.map((key) => key === "MOD" ? (apple ? "CMD" : "CTRL")
  : key === "OPTION" ? (apple ? "OPT" : "ALT") : key === "BOARD" ? (apple ? "CTRL" : "ALT") : key);
const keys = (value) => value.split("|").map((key) => key === "THEN" ? null : key);

function contract(group, title, display, file, ...fragments) {
  const id = `${group}/${title}`;
  const checks = contracts.get(id) ?? [];
  checks.push({ display: keys(display), file: files[file] ?? file, fragments });
  contracts.set(id, checks);
}

function ambiguous(group, title, display, reason) {
  const id = `${group}/${title}`;
  assert.ok(!contracts.has(id), `Duplicate ambiguity ${id}`);
  contracts.set(id, [{ display: keys(display), reason }]);
}

function central(group, title, shortcut) {
  const names = Object.fromEntries(Object.entries(KeyCodes).map(([name, code]) => [code, name]));
  const aliases = { ARROW_LEFT: "←", ARROW_RIGHT: "→", ARROW_UP: "⭡", ARROW_DOWN: "⭣", ESCAPE: "ESC" };
  const modifiers = (shortcut.modifiers ?? []).map((modifier) => modifier.toUpperCase());
  const codes = shortcut.keys ? [...shortcut.keys].reverse() : [shortcut.key];
  const display = [...modifiers, ...codes.map((code) => aliases[names[code]] ?? names[code])];
  contracts.set(`${group}/${title}`, [{ display, shortcut }]);
}

for (const [title, digit, fragment] of [
  ["Inbox", "1", 'router.push("/inbox")'], ["Board", "2", 'navigateToBoard("board")'],
  ["Table", "3", 'navigateToBoard("table")'], ["Calendar", "4", 'router.push("/calendar")'],
  ["Search", "6", "navigateToSearch()"], ["Running timers", "7", "router.push(globalConstants.timersRoute)"],
]) contract("App shell surfaces", title, digit, "shell", `event.key === "${digit}"`, fragment);
contract("App shell surfaces", "Toggle AI chat", "5", "shell", 'AI_CHAT_TOGGLE_KEYS: readonly string[] = ["5", "]"]', "toggleAIChatInterface()");
contract("App shell surfaces", "Toggle AI chat (alternative)", "]", "shell", 'AI_CHAT_TOGGLE_KEYS: readonly string[] = ["5", "]"]', "toggleAIChatInterface()");
contract("App shell surfaces", "Collapse / expand sidebar", rail.RAIL_TOGGLE_KEY, "shell", "event.key === RAIL_TOGGLE_KEY", "setRailExpanded((prev) => !prev)");

const globalGroup = "Global Shortcuts";
contract(globalGroup, "Shortcuts", "?", "global", "e.keyCode === KeyCodes.FORWARD_SLASH && e.shiftKey && !cmdControl", "toggleKeyboardShortcuts()");
contract(globalGroup, "Settings", "\\", "global", "e.keyCode === KeyCodes.BACKSLASH && !cmdControl && !e.shiftKey", "openSettings()");
contract(globalGroup, "Search", "/", "global", "e.keyCode === KeyCodes.FORWARD_SLASH && !cmdControl && !e.shiftKey");
contract(globalGroup, "Set priority", "P", "edit", 'action: "priority", matches: () => e.keyCode === KeyCodes.P && !cmdControl');
contract(globalGroup, "Set task size", "S", "nav", 'action: "estimate", matches: () => e.keyCode === KeyCodes.S && !e.shiftKey && !e.altKey && !cmdControl');
contract(globalGroup, "Add tags", "T", "nav", 'action: "projectOrLabel", matches: () => e.keyCode === KeyCodes.T', "!e.altKey && !e.shiftKey && !cmdControl", "toggleLabelModal()");
contract(globalGroup, "Archive", "E", "row", "e.keyCode === KeyCodes.E && !cmdControl", "archiveNotification(sectionId, task.id)");
contract(globalGroup, "Move focus down", "J", "board", '(e.keyCode === 74 ||e.key==="ArrowDown") && !e.shiftKey && !cmdControl', "spaceship.focus.down()");
contract(globalGroup, "Move focus up", "K", "board", '(e.keyCode === 75 ||e.key==="ArrowUp") && (!e.shiftKey && !cmdControl )', "spaceship.focus.up()");
contract(globalGroup, "Move focus", "←|⭡|⭣|→", "src/lib/utils/keyboardShortcuts.ts", "keys: [KeyCodes.ARROW_LEFT, KeyCodes.H]", "keys: [KeyCodes.ARROW_UP, KeyCodes.K]", "keys: [KeyCodes.ARROW_DOWN, KeyCodes.J]", "keys: [KeyCodes.ARROW_RIGHT, KeyCodes.L]");
contract(globalGroup, "Open Hypertask Command", "MOD|K", "src/app/inbox/Inbox.tsx", "e.keyCode === KeyCodes.K && cmdControl", "toggleShowCommands()");
for (const title of ["New Task", "Compose task"]) contract(globalGroup, title, "MOD|J", "nav", 'action: "aiWriter", matches: () => e.keyCode === KeyCodes.J && cmdControl', 'paletteTab: "compose"');
contract(globalGroup, "Undo latest action", "MOD|Z", "nav", 'action: "undo", matches: () => e.keyCode === KeyCodes.Z && undoData.length > 0', "undoHandler(");
contract(globalGroup, "Use snippet", ";", "detail", 'e.key === ";" && !cmdControl && !e.altKey', "requestCommentSnippetPicker()");
contract(globalGroup, "Show or hide archived tasks", "G|THEN|X", "board", "e.keyCode === 71", "e.keyCode === 88", "lastgClick.current", "toggleShowArchivedOnBoard()");
contract(globalGroup, "Exit (go back)", "ESC", "global", "e.keyCode === KeyCodes.ESCAPE", "GlobalProvidersEscapeHandler()");
ambiguous(globalGroup, "Archive task or comment", "MOD|E", "Cmd/Ctrl+E archives tasks but is inline code inside the editor; comment archive has no distinct matching action.");
contract(globalGroup, "Delete task", "#", "nav", 'action: "deleteTask", matches: () => e.keyCode === KeyCodes.THREE && e.shiftKey && !e.ctrlKey && !e.metaKey');
for (const [title, code, action] of [
  ["Go to task board", "B", "Board"], ["Go to inbox archives", "R", "Inbox Archive"],
  ["Go to running timers", "T", "Timers"], ["Go to reminders", "H", "Reminders"],
  ["Go to all tasks", "A", "All Tasks"], ["Go to my tasks", "M", "My Tasks"],
  ["Go to inbox", "I", "Inbox"], ["Go to snippets", "SEMICOLON", "Snippets"],
  ["Go to archived tasks", "E", "Task Archive"], ["Go to starred", "S", "Starred"],
  ["Go to pinned", "P", "Pinned"], ["Go to drafts", "D", "Drafts"],
  ["Go to scheduled tasks", "U", "Scheduled"], ["Go to calendar", "C", "Calendar"],
]) contract(globalGroup, title, `G|THEN|${code === "SEMICOLON" ? ";" : code}`, "src/lib/keyboard/globalGShortcuts.ts", `[KeyCodes.${code}, "${action}"]`, "event.keyCode === KeyCodes.G");
contract(globalGroup, "Go to trash", "G|THEN|#", "src/lib/keyboard/globalGShortcuts.ts", 'event.keyCode === KeyCodes.THREE ? "Trash" : null', "event.shiftKey");
for (const [title, display] of [["Cycle focus forward", "TAB"], ["Cycle focus backward", "SHIFT|TAB"]]) {
  ambiguous(globalGroup, title, display, "Tab cycles board views with the app-shell rail, but changes focus/splits in other contexts; intended scope needs a decision.");
}
for (const group of [globalGroup, "Task View"]) contract(group, "Switch boards", "BOARD|0-9", helpFile, '/^Digit\\d$/.test(event.code)', "event.ctrlKey && !event.altKey", "event.altKey && !event.ctrlKey");
contract(globalGroup, "Switch Kanban boards", "MOD|B", "global", "e.keyCode === KeyCodes.B", "if (cmdControl)", "toggleLeftSidebar()");
central(globalGroup, "Set due date", shortcuts.dueDateModal.default);
contract(globalGroup, "Move task to a different board", "SHIFT|M", "edit", 'action: "moveToBoard", matches: () => e.keyCode === KeyCodes.M && e.shiftKey && !cmdControl');

contract("Board", "Add task", "C", "section", "e.keyCode === KeyCodes.C", "!(e.altKey || e.shiftKey || e.ctrlKey || e.metaKey)", 'createTaskAt("top"');
contract("Board", "Add task with AI Task Writer", "MOD|J", "section", "e.keyCode === KeyCodes.J", "((isApple && e.metaKey) || (!isApple && e.ctrlKey))", 'defaultEditMode: "Description-ai"');
ambiguous("Board", "Add sub-task", "MOD|SHIFT|+", "Mod+Shift+= links subtasks in task detail, but no board-level handler exists; creating versus linking also needs clarification.");
contract("Board", "Add task at top", "MOD|SHIFT|C", "section", "e.keyCode === KeyCodes.C", "e.shiftKey && (e.ctrlKey || e.metaKey)", 'createTaskAt("top"');
ambiguous("Board", "Add task at bottom", "SHIFT|C", "Legacy Shift+C creates at bottom; quick-add flags intercept it and open a modal instead.");
contract("Board", "Open task", "ENTER", "row", "e.keyCode === KeyCodes.ENTER", "navigateToTask(task.projectId");
contract("Board", "Next view", "]", "views", "event.key === '[' || event.key === ']'", "event.key === ']' ? 1 : -1");
contract("Board", "Previous view", "[", "views", "event.key === '[' || event.key === ']'", "event.key === ']' ? 1 : -1");
contract("Board", "Move focus to top", "gg", "section", "e.keyCode === KeyCodes.G", "lastgPress.current", "const element = tasksList[0]");
contract("Board", "Move focus to bottom", "GG", "section", "e.keyCode === KeyCodes.G", "if (e.shiftKey)", "lastGPress.current", "const targetIndex = tasksList.length - 2");
for (const [title, direction] of [["Move task down", "down"], ["Move task up", "up"], ["Move task right", "right"], ["Move task left", "left"], ["Move task to the left", "left"], ["Move task to the right", "right"]]) central("Board", title, shortcuts.universal_shift[direction]);
contract("Board", "Sort Kanban board", "SHIFT|S", "board", "e.shiftKey && e.keyCode===83", "CommandMode.SortKanbanBoard");
contract("Board", "Add a sort level (table column)", "SHIFT|CLICK", "src/components/PageComponents/Kanban/TableView/TableView.tsx", "onClick={(event) => toggleSort(column.key, event.shiftKey)}");
contract("Board", "Toggle table layout", "SHIFT|T", "board", "e.keyCode === 84 && e.shiftKey", "toggleBoardLayout()");
contract("Board", "Match any / all values (inside a filter's list)", "←|→", "src/components/Modals/FilterModals/MatchModeToggle.tsx", "event.keyCode !== KeyCodes.ARROW_LEFT && event.keyCode !== KeyCodes.ARROW_RIGHT");
for (const group of ["Board", "Task View"]) ambiguous(group, "Show task options", "MOD|SHIFT|+", "The matching binding links a subtask; no distinct task-options handler was found. Do not relabel without product intent.");
for (const group of ["Board", "Task View"]) contract(group, "Assign a user", "A", "nav", 'action: "assign", matches: () => e.keyCode === KeyCodes.A && !e.shiftKey', "aHandler()");

const taskGroup = "Task View";
contract(taskGroup, "Activate description/comment or reply to comment", "ENTER", "edit", 'action: "enter", matches: () => e.key === "Enter" && !cmdControl');
contract(taskGroup, "Send comment and advance in Inbox", "MOD|ENTER", "src/lib/taskDetailInboxFlow.ts", 'if (!commandKey || key !== "Enter") return null', 'return isInboxFlow ? "send-and-move" : "send"');
contract(taskGroup, "Send comment and stay on task", "MOD|SHIFT|ENTER", "src/lib/taskDetailInboxFlow.ts", 'if (shiftKey) return "send-and-stay"');
contract(taskGroup, "Write with AI", "MOD|J", "nav", 'action: "aiWriter", matches: () => e.keyCode === KeyCodes.J && cmdControl');
contract(taskGroup, "Blocked by person", "SHIFT|B", "nav", 'action: "blockedBy", matches: () => e.keyCode === KeyCodes.B && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey');
contract(taskGroup, "Start / stop timer", "W", "time", 'if (event.key === "w")', "void toggle()");
contract(taskGroup, "Log time", "B", "time", '(event.key !== "b" && event.key !== "w")', "setShowTimeLog(true)");
for (const title of ["Add a comment", "Write Comment"]) contract(taskGroup, title, "MOD|M", "edit", 'action: "comment", matches: () => (e.keyCode === KeyCodes.M && !e.shiftKey && cmdControl)');
contract(taskGroup, "Suggest reply with AI", "SHIFT|R", "edit", 'action: "suggestReply", matches: () => e.keyCode === KeyCodes.R && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey');
contract(taskGroup, "Expand summary", "I", "edit", 'action: "summary", matches: () => e.keyCode === KeyCodes.I && !e.shiftKey && !e.ctrlKey && !cmdControl');
contract(taskGroup, "Expand single comment", "O", "comments", "e.keyCode === 79 && !cmdControl && !e.shiftKey", "updateStackedComments(parseInt(currentIndex))");
contract(taskGroup, "Expand all comments", "SHIFT|O", "comments", "e.keyCode === 79 && e.shiftKey && !cmdControl", "toggleAllComments()");
contract(taskGroup, "__history__", "MOD|SHIFT|H", "edit", 'action: "history", matches: () => cmdControl && e.shiftKey && e.keyCode === KeyCodes.H');
contract(taskGroup, "View all links", "MOD|O", "detail", "e.keyCode === KeyCodes.O && cmdControl && !e.shiftKey", "linksModalToggle()");
contract(taskGroup, "Edit Description", "CTRL|D", "edit", "e.keyCode === KeyCodes.D && e.ctrlKey && !e.shiftKey", "requestDescriptionFocus(");
contract(taskGroup, "Edit Title", "F2", "comments", "e.keyCode === 113", 'setEditMode("title")');
contract(taskGroup, "Delete comment", "CTRL|SHIFT|3", "detail", 'e.ctrlKey && e.shiftKey && e.key === "#"', "setShowCommentDeleteModal(true)");
contract(taskGroup, "Paste as plain text", "MOD|SHIFT|V", "src/components/RTE/Extensions/Hypertask-Links/index.ts", "const isModifierPressed = event.metaKey || event.ctrlKey", "isModifierPressed && event.shiftKey && event.keyCode === KeyCodes.V", "allowRawPaste = true");
ambiguous(taskGroup, "View all sub-tasks", "CTRL|O", "Ctrl+O opens links on Windows; subtask linking uses Mod+Shift+=, but linking and viewing are not the same action.");
contract(taskGroup, "Share task", "MOD|S", "nav", 'action: "share", matches: () => e.keyCode === KeyCodes.S && cmdControl && !e.altKey && !e.shiftKey');
for (const [title, display, action, expression] of [
  ["Private share link (URL only)", "MOD|SHIFT|;", "copyUrl", "e.keyCode === KeyCodes.SEMICOLON && cmdControl && e.shiftKey && !e.altKey"],
  ["Private share link (Title + URL)", "MOD|;", "copyFormattedUrl", "(e.keyCode === KeyCodes.SEMICOLON || e.keyCode === KeyCodes.COMMA) && cmdControl && !e.shiftKey && !e.altKey"],
  ["Public share link (URL only)", "MOD|SHIFT|.", "copySharedUrl", "e.keyCode === KeyCodes.PERIOD && cmdControl && e.shiftKey"],
  ["Public share link (Title + URL)", "MOD|.", "copySharedFormattedUrl", "e.keyCode === KeyCodes.PERIOD && cmdControl && !e.shiftKey"],
  ["Copy task ID", "MOD|SHIFT|I", "copyTicket", "e.keyCode === KeyCodes.I && cmdControl && e.shiftKey"],
  ["Copy task title and ID", "MOD|I", "copyTitle", "e.keyCode === KeyCodes.I && cmdControl && !e.shiftKey"],
  ["Star task", "ALT|S", "star", "e.keyCode === KeyCodes.S && e.altKey && !e.shiftKey"],
  ["Follow task", "F", "follow", "e.keyCode === KeyCodes.F && !e.altKey && !e.shiftKey && !cmdControl"],
  ["Unfollow task", "ALT|F", "unfollow", "e.keyCode === KeyCodes.F && e.altKey && !e.shiftKey"],
]) contract(taskGroup, title, display, "nav", `action: "${action}", matches: () => ${expression}`);
for (const [title, code] of [["Star comment", 83], ["Pin comment", 80]]) contract(taskGroup, title, `CTRL|SHIFT|${String.fromCharCode(code)}`, "comments", `e.keyCode === ${code} && e.ctrlKey && e.shiftKey`, "handlePinComment(");
contract(taskGroup, "Speech to text", "MOD|SHIFT|D", "edit", 'action: "dictate", matches: () => e.shiftKey && cmdControl && e.keyCode === KeyCodes.D');
contract(taskGroup, "Dictate and Improve", "MOD|SHIFT|F", "edit", 'action: "dictateAndImprove", matches: () => e.shiftKey && cmdControl && e.keyCode === KeyCodes.F');
contract(taskGroup, "Discard draft", "MOD|SHIFT|,", "comments", "e.keyCode === KeyCodes.COMMA && e.shiftKey && cmdControl", 'setResetDraft("Comment")');

for (const [title, display, expression] of [
  ["Save", "MOD|ENTER", '!e.altKey && !e.shiftKey) CtrlEnterHandler("Save")'],
  ["Save and close", "MOD|OPTION|ENTER", 'e.altKey && !e.shiftKey) CtrlEnterHandler("SaveAndClose")'],
  ["Save and create new task", "MOD|OPTION|SHIFT|ENTER", 'e.altKey && e.shiftKey) CtrlEnterHandler("SaveAndNew")'],
]) contract("Saving new task", title, display, "save", 'cmdControl && e.key === "Enter"', expression);
contract("AI Chat", "Toggle AI chat", "MOD|SHIFT|?", "ai", "e.keyCode === KeyCodes.FORWARD_SLASH && cmdControl && e.shiftKey");
contract("AI Chat", "Reset session", "MOD|SHIFT|O", "ai", "(e.keyCode === KeyCodes.O || e.keyCode === KeyCodes.J) && e.shiftKey && cmdControl", "startNewSession()");
contract("AI Chat", "Switch focus: AI chat / workspace", "CTRL|Q", "ai", "e.keyCode === KeyCodes.Q && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey");
contract("AI Chat", "Send message", "Enter", "ai", "e.keyCode === KeyCodes.ENTER && !e.shiftKey", "handleSendMessage()");
for (const [title, arrow] of [["Next agent", "ArrowDown"], ["Previous agent", "ArrowUp"]]) contract("Agent Chat", title, `OPTION|${arrow === "ArrowDown" ? "⭣" : "⭡"}`, "cycle", 'e.altKey && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")', 'e.key === "ArrowDown" ? 1 : -1');
ambiguous("Agent Chat", "Send message", "MOD|ENTER", "Enter alone also sends; documented Mod+Enter works, but selecting the canonical shortcut needs a wording decision.");
contract("Agent Chat", "Open all links in latest reply", "CTRL|O", "cycle", 'e.ctrlKey && e.key.toLowerCase() === "o"', "openLatestReplyLinks()");
contract("Agent Chat", "Search tasks to reference", "@", "agent", "beforeCursor.match(/(?:^|\\s)@([^\\s@]*)$/)");
for (const [title, arrow] of [["Next team (any page)", "⭣"], ["Previous team (any page)", "⭡"]]) contract("Agent Chat", title, `OPTION|SHIFT|${arrow}`, "global", "e.altKey && e.shiftKey && !cmdControl", "e.keyCode === KeyCodes.ARROW_DOWN || e.keyCode === KeyCodes.ARROW_UP", "setAgentChatTeamCycle({ direction, seq: teamCycleSeq.current })");

contract("Format", "Tiptap menu", "/", "src/components/RTE/Extensions/SlashCommands/SlashCommands.tsx", 'char: "/"');
ambiguous("Format", "Add Video Embed", "MOD|Y", "No embed shortcut found; Tiptap UndoRedo uses Mod+Y for redo. Removing or replacing the help action needs intent.");
ambiguous("Format", "Autocomplete sentence", "2xTAB", "No double-Tab completion handler found; do not add or remove an action without product intent.");
for (const [title, display, packageName, exportName, binding] of [
  ["Add a line break", "SHIFT|ENTER", "extension-hard-break", "HardBreak", "Shift-Enter"],
  ["Apply normal text style", "MOD|OPTION|0", "extension-paragraph", "Paragraph", "Mod-Alt-0"],
  ["Italicize", "MOD|I", "extension-italic", "Italic", "Mod-i"],
  ["Underline", "MOD|U", "extension-underline", "Underline", "Mod-u"],
  ["Quote", "MOD|SHIFT|B", "extension-blockquote", "Blockquote", "Mod-Shift-b"],
  ["Highlight", "MOD|SHIFT|H", "extension-highlight", "Highlight", "Mod-Shift-h"],
  ["Code", "MOD|E", "extension-code", "Code", "Mod-e"],
  ["Bullet list", "MOD|SHIFT|8", "extension-bullet-list", "BulletList", "Mod-Shift-8"],
  ["Undo", "MOD|Z", "extensions", "UndoRedo", "Mod-z"],
  ["Redo", "MOD|SHIFT|Z", "extensions", "UndoRedo", "Shift-Mod-z"],
]) {
  const extension = require(`@tiptap/${packageName}`)[exportName];
  const bindings = extension.config.addKeyboardShortcuts.call({ editor: {} });
  assert.ok(Object.hasOwn(bindings, binding), `${exportName} no longer handles ${binding}`);
  contract("Format", title, display, "src/components/RTE/Tiptap.ts", "StarterKit.configure(");
}
const { Heading } = require("@tiptap/extension-heading");
const headingBindings = Heading.config.addKeyboardShortcuts.call({ options: { levels: [1, 2, 3, 4, 5, 6] }, editor: {} });
for (let level = 1; level <= 6; level++) {
  assert.ok(Object.hasOwn(headingBindings, `Mod-Alt-${level}`));
  contract("Format", `Apply heading style ${level}`, `MOD|OPTION|${level}`, "src/components/RTE/Tiptap.ts", "StarterKit.configure(");
}
contract("Format", "Code block", "MOD|OPTION|SHIFT|C", "editor", "if (cmdControl)", "if (e.shiftKey)", '"67": () =>', "if (e.altKey)", 'type: "codeBlock"');
contract("Format", "Code", "MOD|SHIFT|C", "editor", "if (cmdControl)", "if (e.shiftKey)", '"67": () =>', ".setCode()");

contract("Inbox", "Select ALL", "MOD|SHIFT|A", "bulk", "cmdControl && e.shiftKey && e.keyCode === KeyCodes.A", "selectAllFromAllTabs()");
contract("Inbox", "Select all from current split", "MOD|A", "bulk", "cmdControl && e.keyCode === KeyCodes.A", "selectAll()");
contract("Inbox", "Select message", "X", "bulk", "e.keyCode === KeyCodes.X && !e.shiftKey && !cmdControl", "toggleSelection(currentItem.id)");
for (const [title, display, code] of [["Bulk Archive", "SHIFT|E", "E"], ["Bulk Reminder", "SHIFT|H", "H"]]) {
  contract("Inbox", title, display, "inbox", `keyboardShortcut: [KeyCodes.${code}]`);
}
contract("Inbox", "Archive", "E", "inbox", "e.keyCode === KeyCodes.E", 'eHandler(cmdControl, undefined, "keyboard")');
contract("Inbox", "Open task", "ENTER", "inbox", "e.keyCode === KeyCodes.ENTER", 'openTask("view")');
contract("Inbox", "Move focus down", "J", "inbox", "e.keyCode === KeyCodes.J || e.keyCode === KeyCodes.ARROW_DOWN");
contract("Inbox", "Move focus up", "K", "inbox", "(e.keyCode === KeyCodes.K || e.keyCode === KeyCodes.ARROW_UP) && !cmdControl");
contract("Inbox", "Archive task", "MOD|E", "inbox", "e.keyCode === KeyCodes.E && cmdControl", 'eHandler(cmdControl, undefined, "keyboard")');

for (const [title, shortcut] of [
  ["Add task", shortcuts.calendar.add_task], ["Update due date", shortcuts.dueDateModal.default],
  ["Next month/week", shortcuts.calendar.next_group], ["Previous month/week", shortcuts.calendar.previous_group],
  ["Month view", shortcuts.calendar.month_view], ["Week view", shortcuts.calendar.week_view],
  ["Day view", shortcuts.calendar.day_view], ["Focus on today", shortcuts.calendar.focus_today],
  ["Focus on next day", shortcuts.calendar.focus_next_day], ["Focus on yesterday", shortcuts.calendar.focus_previous_day],
]) central("Calendar", title, shortcut);
contract("Calendar", "Toggle through project filters", "MOD|[|]", "calendar", "(event.keyCode === KeyCodes.CLOSE_BRACKET || event.keyCode === KeyCodes.OPEN_BRACKET) && cmdControl");
contract("Calendar", "Select project from filters", "SPACE", "calendar", "event.keyCode === KeyCodes.SPACE", "handleProjectToggle(");
contract("Calendar", "Filter tasks", "SHIFT|F", "calendar", "event.keyCode === KeyCodes.F && event.shiftKey", "setShowFilterModal(true)");
ambiguous("Calendar", "Save calendar view", "SHIFT|V", "No save-view keyboard handler exists in useCalendarKeyboard; whether to remove the entry or restore behavior is unclear.");
contract("Unarchive View (g -> e)", "Unarchive task", "MOD|E", "archived", 'e.key === "e" && (osName === "MacOS"?e.metaKey:e.ctrlKey)', "eHandler()");
ambiguous("Unarchive View (g -> e)", "Delete task", "#", "ArchivedTasksComp has no delete-key handler; trash and normal-task deletion are different contexts.");

function assertHelp(rows, apple) {
  const seen = new Set();
  for (const group of rows) {
    const occurrences = new Map();
    for (const row of group.sub) {
      const id = `${group.title}/${row.shortTitle}`;
      const occurrence = occurrences.get(id) ?? 0;
      occurrences.set(id, occurrence + 1);
      const definitions = contracts.get(id);
      assert.ok(definitions, `Unaudited help entry: ${id}`);
      const definition = definitions[occurrence];
      assert.ok(definition, `Unexpected duplicate help entry: ${id}`);
      assert.deepEqual(row.pressKey, normalize(definition.display, apple), id);
      seen.add(id);
      if (definition.shortcut) {
        for (const code of definition.shortcut.keys ?? [definition.shortcut.key]) {
          const event = { keyCode: code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
          for (const modifier of definition.shortcut.modifiers ?? []) event[`${modifier}Key`] = true;
          assert.ok(matchesShortcut(event, definition.shortcut), id);
        }
      }
      if (definition.file) {
        const source = compact(read(definition.file));
        assert.ok(definition.fragments.length, `No handler evidence: ${id}`);
        for (const fragment of definition.fragments) assert.ok(source.includes(compact(fragment)), `${id}: handler changed in ${definition.file}: ${fragment}`);
      }
    }
    for (const [id, count] of occurrences) {
      assert.equal(count, contracts.get(id).length, `Missing duplicate help entry: ${id}`);
    }
  }
  return seen;
}

test("every shortcut help entry matches its audited handler on both platforms and all help modes", () => {
  const seen = new Set();
  for (const apple of [false, true]) for (const shell of [false, true]) {
    for (const compose of [false, true]) for (const newTask of [false, true]) {
      const rows = getKeyboardShortcuts(apple, shell, "__history__", compose, newTask);
      for (const id of assertHelp(rows, apple)) seen.add(id);
    }
  }
  assert.deepEqual([...seen].sort(), [...contracts.keys()].sort(), "Removed entries must also remove their audit contracts");
});

test("the original Shift+D help typo is rejected, including task-detail due-date config", () => {
  assert.equal(shortcuts.dueDateModal.default.key, KeyCodes.D);
  for (const config of Object.values(shortcuts.dueDateModal)) {
    assert.ok(matchesShortcut({ keyCode: KeyCodes.D, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, config));
    assert.ok(!matchesShortcut({ keyCode: KeyCodes.D, shiftKey: true, ctrlKey: false, metaKey: false, altKey: false }, config));
  }
  const rows = getKeyboardShortcuts(false);
  const dueDate = rows.find((group) => group.title === globalGroup).sub.find((row) => row.shortTitle === "Set due date");
  dueDate.pressKey = ["SHIFT", "D"];
  assert.throws(() => assertHelp(rows, false), /Set due date/);
});

for (const [id, definitions] of contracts) {
  if (definitions[0].reason) test.todo(`${id}: ${definitions[0].reason}`);
}
