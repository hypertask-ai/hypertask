const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getAcceptDestination } = jiti(
  path.join(root, "src/utils/triageDestination.ts")
);
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")
);

const section = (id, title, ranking) => ({
  id,
  sectionId: id,
  section_title: title,
  ranking,
  items: [],
});

const taskOptions = (isArchived = false) => ({
  isApple: false,
  isArchived,
  hasNotifications: false,
  isKanban: true,
  hasSubtasks: false,
  hasParent: false,
  isStarred: false,
  timeTrackingEnabled: false,
});

test("Accept picks the first later non-triage section by ranking", () => {
  const sections = [
    section(3, "Backlog", "A0300"),
    section(1, "Triage", "A0100"),
    section(2, "Intake", "A0200"),
    section(4, "Ready", "A0400"),
  ];

  assert.equal(getAcceptDestination(sections, 1)?.id, 3);
});

test("Accept falls back to the immediately next ranked section", () => {
  const sections = [
    section(3, "Doing", "A0300"),
    section(1, "Ideas", "A0100"),
    section(2, "Backlog", "A0200"),
  ];

  assert.equal(getAcceptDestination(sections, 1)?.id, 2);
  assert.equal(getAcceptDestination(sections, 3), undefined);
  assert.equal(getAcceptDestination(sections, 99), undefined);
});

test("triage commands are task-context palette actions without bare shortcuts", () => {
  const taskCommands = getAllCommands({
    context: "Task",
    taskOptions: taskOptions(),
  })[0].commandLists;
  const triageCommands = taskCommands.filter((command) =>
    [
      CommandMode.AcceptTask,
      CommandMode.DeclineTask,
      CommandMode.DeclineAsDuplicateOf,
    ].includes(command.commandMode)
  );

  assert.deepEqual(
    triageCommands.map((command) => command.name),
    ["Accept task", "Decline task", "Decline as duplicate of…"]
  );
  assert.ok(triageCommands.every((command) => command.keyboard === undefined));
});

test("triage commands do not offer archive actions for archived tasks", () => {
  const taskCommands = getAllCommands({
    context: "Task",
    taskOptions: taskOptions(true),
  })[0].commandLists;

  assert.ok(
    taskCommands.every(
      (command) =>
        command.commandMode !== CommandMode.AcceptTask &&
        command.commandMode !== CommandMode.DeclineTask &&
        command.commandMode !== CommandMode.DeclineAsDuplicateOf
    )
  );
});
