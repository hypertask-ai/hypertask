const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("./refactored-module-source.cjs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const sections = read("src/hooks/Homepage/useSections.ts");
const boardKeys = read("src/hooks/Homepage/useHandleKeyDownOperations.ts");
const shortcuts = read("src/lib/constants/shortcuts.ts");

test("ctrl/cmd+J opens the new task straight into the AI Task Writer", () => {
  const branch = sections.slice(sections.indexOf("e.keyCode === KeyCodes.J"));
  assert.ok(
    /e\.keyCode === KeyCodes\.J/.test(sections),
    "the board must bind J at all — it was previously commented out",
  );
  assert.ok(
    /createTaskAt\(/.test(branch),
    "the binding must create a task, same as [C]",
  );
  const call = branch.slice(0, branch.indexOf("setKeypressed"));
  assert.ok(
    /defaultEditMode:\s*"Description-ai"/.test(call),
    "the create modal must open in AI writer mode, not plain title mode",
  );
  assert.ok(
    /defaultFocus:\s*"Description"/.test(call),
    "focus must land in the description so the user can type a prompt immediately",
  );
});

test("the binding preventDefaults so the browser Downloads panel stays shut", () => {
  const branch = sections.slice(sections.indexOf("e.keyCode === KeyCodes.J"));
  const body = branch.slice(branch.indexOf("{"), branch.indexOf("createTaskAt("));
  assert.ok(
    /e\.preventDefault\(\)/.test(body),
    "preventDefault must run before the modal opens",
  );
});

test("the binding is modifier-exact", () => {
  const branch = sections.slice(sections.indexOf("e.keyCode === KeyCodes.J"));
  const condition = branch.slice(0, branch.indexOf("{"));
  assert.ok(
    /isApple && e\.metaKey/.test(condition) && /!isApple && e\.ctrlKey/.test(condition),
    "cmd on Apple, ctrl elsewhere — matching every other cmdControl binding",
  );
  assert.ok(
    /!e\.shiftKey/.test(condition),
    "shift+cmd+J belongs to the AI chat toggle and must not also create a task",
  );
});

test("plain [j] focus movement ignores cmd/ctrl", () => {
  const line = boardKeys
    .split("\n")
    .find((l) => l.includes("e.keyCode === 74") && l.includes("ArrowDown"));
  assert.ok(line, "the j/ArrowDown focus-down branch must still exist");
  assert.ok(
    /!cmdControl/.test(line),
    "j must not move focus while cmd/ctrl is held, or Ctrl+J does two things at once",
  );
});

test("registration 1 of 4: the ? cheatsheet and Settings list it under Board", () => {
  const board = shortcuts.slice(shortcuts.indexOf('title: "Board"'));
  const group = board.slice(0, board.indexOf('title: "Saving new task"'));
  assert.ok(
    /AI Task Writer".*pressKey: \[cmdControl, "J"\]/.test(group),
    "Board group must document cmd/ctrl+J",
  );
});

test("registration 2 of 4: the ctrl+K palette can find it by name", () => {
  const commands = read("src/components/Modals/commands/HTC/AllCommands.ts");
  const board = commands.slice(commands.indexOf('group: "Board"'));
  const entry = board.slice(0, board.indexOf('key: "sendFeedback"'));
  assert.ok(
    /commandMode: CommandMode\.CreateTaskWithAiWriter/.test(entry),
    "the Board palette group needs its own entry, not just the keydown handler",
  );
  assert.ok(
    /keyboard: \["CTRL", "J"\]/.test(entry),
    "the palette row must show the shortcut so the two surfaces teach the same key",
  );

  const dispatch = read("src/components/commandDispatcher.ts").split("function dispatchCommandGroup1")[1];
  const branch = dispatch.slice(
    dispatch.indexOf("case CommandMode.CreateTaskWithAiWriter:"),
  );
  assert.ok(branch.length > 0, "commands.tsx must handle the new CommandMode");
  const body = branch.slice(0, branch.indexOf("break;"));
  assert.ok(
    /defaultEditMode:\s*"Description-ai"/.test(body),
    "the palette route must open the AI writer, matching what the key does",
  );
});

test("registration 3 of 4: the canonical registry records the binding", () => {
  const registry = read("docs/keyboard-shortcuts-registry.md");
  const boardSection = registry.slice(
    registry.indexOf("## Board / table / task list"),
  );
  const section = boardSection.slice(0, boardSection.indexOf("## Task detail"));
  assert.ok(
    /`Mod\+J`/.test(section),
    "the board section of the registry must list Mod+J, or the next audit reads the key as free",
  );
});

test("the new CommandMode is appended, never inserted", () => {
  const enums = read("src/models/enums.ts");
  const block = enums.slice(
    enums.indexOf("export enum CommandMode"),
    enums.indexOf("}", enums.indexOf("export enum CommandMode")),
  );
  const members = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z]\w*,$/.test(l));
  assert.equal(
    members[members.indexOf("CreateTaskWithAiWriter,") - 1],
    "ToggleFilterValueMatch,",
    "existing persisted command modes must keep their relative positions",
  );
  assert.equal(
    members[members.indexOf("CreateSmartSplit,") - 1],
    "ManageCustomFields,",
    "later modes must be appended without shifting CreateSmartSplit's persisted ordinal",
  );
});
