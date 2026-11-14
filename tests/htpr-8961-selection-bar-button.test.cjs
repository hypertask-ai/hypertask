const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const definitionFile = "src/lib/flags/definitions/htpr-8961-selection-bar-button.ts";

function openActionsButton(on) {
  const ui = mount();
  const load = loader({
    "@/hooks/useFlag": { useFlag: (key) => on && key === "htpr-8961-selection-bar-button" },
    "@/lib/contexts/Kanban/BulkSelectionContext": { useKanbanBulkSelection: () => ({
      selectedCount: 2, failedIds: new Set(), isProcessing: false,
      archiveSelected: async () => {}, openBulkCommand: () => {}, clearSelection: () => {},
    }) },
  });
  const Bar = load("src/components/PageComponents/Kanban/KanbanHomepageComponents/KanbanBulkActionBar.tsx").default;
  try {
    ui.render(React.createElement(Bar));
    return [...ui.container.querySelectorAll("button")].find(button => button.textContent === "Open actions").className;
  } finally { ui.close(); }
}

test("HTPR-8961 flag on: Open actions uses the neutral filled button", () => {
  const className = openActionsButton(true);
  assert.match(className, /\bbg-white-black\b/);
  assert.match(className, /\btext-white-black-inverted\b/);
  assert.match(className, /\brounded-\[4px\]/);
  assert.doesNotMatch(className, /hypertasks-purple/);
});

test("HTPR-8961 flag off: Open actions keeps the old button", () => {
  const className = openActionsButton(false);
  assert.match(className, /\bbg-hypertasks-purple\b/);
  assert.doesNotMatch(className, /bg-white-black/);
});

test("HTPR-8961 flag is an improvement at Owner + QA", () => {
  const definition = loader()(definitionFile).default;
  assert.equal(definition.key, "htpr-8961-selection-bar-button");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
});
