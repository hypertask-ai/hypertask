const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { load: loadRoute } = require("./task-route-loader.cjs");
const { CommandMode } = loadRoute("src/models/enums.ts", {});

for (const enabled of [false, true]) test(`Kanban bulk bar ${enabled ? "reuses working quick actions and clickable Esc" : "is unchanged with flag off"}`, () => {
  const ui = mount();
  const calls = [];
  let processing = false;
  let count = 2;
  const load = loader({
    "@/hooks/useFlag": { useFlag: () => enabled },
    "@/lib/contexts/Kanban/BulkSelectionContext": { useKanbanBulkSelection: () => ({
      selectedCount: count, failedIds: new Set(), isProcessing: processing,
      archiveSelected: async () => calls.push("archive"),
      openBulkCommand: mode => calls.push(mode ?? "actions"), clearSelection: () => calls.push("clear"),
    }) },
    "@/lib/contexts/MyTasks/BulkSelectionContext": { useMyTasksBulkSelection: () => { throw new Error("My Tasks context must not be used by Kanban"); } },
  });
  const Bar = load("src/components/PageComponents/Kanban/KanbanHomepageComponents/KanbanBulkActionBar.tsx").default;
  const render = () => ui.render(React.createElement(Bar));
  try {
    render();
    const buttons = [...ui.container.querySelectorAll("button")];
    assert.deepEqual(buttons.map(button => button.getAttribute("aria-label") || button.textContent), enabled ?
      ["Archive selected", "Assign selected", "Label selected", "Move selected", "Open actions", "Esc"] : ["Open actions"]);
    for (const button of buttons) React.act(() => button.click());
    assert.deepEqual(calls, enabled ? ["archive", CommandMode.OpenAssignModal, CommandMode.LabelModal,
      CommandMode.MoveToColumn, "actions", "clear"] : ["actions"]);
    if (!enabled) assert.ok(ui.container.textContent.includes("Esc to clear"));
    else assert.equal(ui.container.querySelectorAll("svg").length, 4);
    processing = true;
    render();
    assert.equal(ui.container.querySelector('button[aria-label="Archive selected"]')?.disabled, enabled ? true : undefined);
    assert.equal([...ui.container.querySelectorAll("button")].find(button => button.textContent === "Open actions").disabled, true);
    count = 0;
    render();
    assert.equal(ui.container.innerHTML, "");
  } finally { ui.close(); }
});
