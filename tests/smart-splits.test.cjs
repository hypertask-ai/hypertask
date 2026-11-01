const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/smart-splits-jiti.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const {
  buildSmartSplitBoardFilters,
  getManagedSmartLabelIds,
  getProtectedSmartLabelIds,
  getSmartSplitLabel,
  removeLabelFromBoardFilters,
  replaceLabelNameInBoardFilters,
} = jiti(path.join(root, "src/lib/smartSplits.ts"));
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"),
);

const smartLabel = {
  id: "smart-1",
  value: "Needs design",
  ai_prompt: "Tasks that need design work",
};
const plainLabel = { id: "plain-1", value: "Customer", ai_prompt: null };

const view = (searchPayload, id = "legacy-view") => ({
  id,
  board_filters: {
    matchFilters: "ALL",
    addedFilters: [
      { type: "Labels", match: "ANY", searchPayload },
      { type: "Priority", searchPayload: [{ id: 1 }] },
    ],
  },
});

test("a view with exactly one smart-label reference is a smart split", () => {
  assert.equal(
    getSmartSplitLabel(view([smartLabel, plainLabel]), [smartLabel, plainLabel]),
    smartLabel,
  );
});

test("missing and repeated smart-label references are rejected as ambiguous", () => {
  assert.equal(getSmartSplitLabel(view([plainLabel]), [smartLabel, plainLabel]), null);
  assert.equal(
    getSmartSplitLabel(view([smartLabel, smartLabel]), [smartLabel, plainLabel]),
    null,
  );
});

test("paired ids keep one smart split stable when another view uses its label", () => {
  const pairedLabel = { ...smartLabel, id: "paired" };
  const pairedView = view([pairedLabel], "paired");
  const ordinaryView = view([pairedLabel], "ordinary");
  const views = [pairedView, ordinaryView];

  assert.equal(getSmartSplitLabel(pairedView, [pairedLabel], views), pairedLabel);
  assert.equal(getSmartSplitLabel(ordinaryView, [pairedLabel], views), null);
  assert.deepEqual([...getManagedSmartLabelIds(views, [pairedLabel])], ["paired"]);
});

test("legacy pairing requires one saved view and leaves shared smart labels manageable", () => {
  const legacyView = view([smartLabel], "legacy");
  const ordinaryView = view([smartLabel], "ordinary");

  assert.equal(getSmartSplitLabel(legacyView, [smartLabel], [legacyView]), smartLabel);
  assert.equal(
    getSmartSplitLabel(legacyView, [smartLabel], [legacyView, ordinaryView]),
    null,
  );
  assert.equal(
    getManagedSmartLabelIds([legacyView, ordinaryView], [smartLabel]).has(smartLabel.id),
    false,
  );
  assert.equal(getManagedSmartLabelIds([], [smartLabel]).has(smartLabel.id), false);
});

test("smart labels fail closed until saved-view metadata is hydrated", () => {
  assert.deepEqual([...getProtectedSmartLabelIds(undefined, [smartLabel, plainLabel])], [
    smartLabel.id,
  ]);
  assert.equal(
    getProtectedSmartLabelIds([view([plainLabel])], [smartLabel, plainLabel]).has(smartLabel.id),
    false,
  );
});

test("smart split creation stores one normal Labels filter", () => {
  assert.deepEqual(buildSmartSplitBoardFilters(smartLabel), {
    matchFilters: "ALL",
    addedFilters: [
      {
        type: "Labels",
        match: "ANY",
        searchPayload: [{ id: "smart-1", value: "Needs design" }],
      },
    ],
  });
});

test("rename and delete update persisted label payloads without touching other filters", () => {
  const filters = view([smartLabel, plainLabel]).board_filters;
  const renamed = replaceLabelNameInBoardFilters(filters, smartLabel.id, "Design queue");
  assert.equal(renamed.addedFilters[0].searchPayload[0].value, "Design queue");
  assert.deepEqual(renamed.addedFilters[1], filters.addedFilters[1]);

  const removed = removeLabelFromBoardFilters(renamed, smartLabel.id);
  assert.deepEqual(removed.addedFilters[0].searchPayload, [plainLabel]);
  assert.deepEqual(removed.addedFilters[1], filters.addedFilters[1]);
});

test("deleting the only label removes the empty Labels filter", () => {
  const removed = removeLabelFromBoardFilters(
    view([smartLabel]).board_filters,
    smartLabel.id,
  );
  assert.deepEqual(removed.addedFilters, [
    { type: "Priority", searchPayload: [{ id: 1 }] },
  ]);
});

test("Ctrl+K offers Add smart split on board contexts only", () => {
  const findCommand = (context) =>
    getAllCommands({ context })
      .flatMap((group) => group.commandLists)
      .find((command) => command.commandMode === CommandMode.CreateSmartSplit);

  assert.equal(findCommand("Kanban")?.name, "Add smart split");
  assert.equal(findCommand("Task")?.name, "Add smart split");
  assert.equal(findCommand("Others"), undefined);
});
