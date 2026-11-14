const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");
const grouping = loadModule("src/lib/table-view/tableGroupByTag.ts");
const noop = () => null;
const sections = [{ sectionId: 10, section_title: "Backlog", items: [{ id: 1, title: "One" }] }];

for (const action of ["hide", "filter"]) {
  test(`table restores ${action === "hide" ? "all hidden groups" : "a filtered group"} without desktop shell controls`, () => {
    const dom = new JSDOM("<div id='root'></div>");
    const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(dom.window, "innerWidth", { value: 390 });
    let enabled = true;
    let saved = grouping.serializeEffectiveTableGrouping(grouping.applyTableGroupAction(grouping.parseTableGrouping("column"), action, "10"));
    const writes = [];
    const TableView = loadModule("src/components/PageComponents/Kanban/TableView/TableView.tsx", {
      "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: noop },
      "./tableViewShared": { TABLE_GRID_CLASS: "grid", SECTION_CAP: 100, isTaskRow: (row) => row.type === "task" },
      "@/hooks/useFlag": { useFlag: (key) => key === "htpr-8974-table-group-modes" && enabled },
      "./useTableState": { useTableState: ({ _currentProject }) => ({
        sections: grouping.buildTableSectionsForGrouping(sections, grouping.effectiveTableGrouping(_currentProject, enabled, false)),
        sortState: [], expanded: new Set(), collapsedSections: new Set(), showCommands: { show: false },
        setTableGroupVisibilityViewAndReturn: (project, nextAction, id) => {
          writes.push([project.id, nextAction, id]);
          saved = grouping.serializeEffectiveTableGrouping(grouping.applyTableGroupAction(grouping.parseTableGrouping(saved), nextAction, id));
          render();
        },
      }) },
      "./useTableColumns": { useTableColumns: () => ({ visibleColumns: [], storedColumnKeys: new Set() }) },
      "./useTableRows": { useTableRows: () => ({ rows: [] }) },
      "./useTableActions": { useTableActions: () => ({}) },
      "./useTableKeyboard": { useTableKeyboard: () => ({}) },
      "./TableTaskRow": { createTableRowRenderer: () => ({ renderTaskRow: (task) => React.createElement("li", { key: task.id }, task.title) }) },
      "../HeaderComponents/ShellViewControls": { ViewControlButton: ({ label, onClick, className, children }) => React.createElement("button", { "aria-label": label, onClick, className }, children) },
      "@/components/Modals/OptionPicker": { default: ({ options, onSelect }) => React.createElement("div", null, options.map((option) => React.createElement("button", { key: option.id, onClick: () => onSelect(option) }, option.label))) },
      "@/components/Common/TaskRowComponents/TaskListRow": { SplitTitle: ({ tab }) => React.createElement("span", null, tab.project) },
      "./TableCreateTaskControl": { TableCreateTaskControl: noop, getTableCreateTaskControlProps: () => ({}) },
      "@/store": { LOCKED_TABLE_COLUMNS: new Set() },
      "@/utils": { taskBaseUri: "" },
      "@/components/Common/selection-checkbox": { default: noop },
    }).default;
    const root = createRoot(dom.window.document.getElementById("root"));
    function render() {
      root.render(React.createElement(TableView, {
        _currentProject: { id: 15, project_view: { user_project_views: [{ appliedView: { table_group_by: saved } }] } },
        filteredSections: sections, _sections: sections,
      }));
    }
    const recovery = () => dom.window.document.querySelector('button[aria-label="Show all groups"]');
    try {
      React.act(render);
      assert.ok(recovery(), "recovery remains available even when no group headers remain");
      assert.equal(dom.window.document.querySelectorAll("li").length, action === "hide" ? 0 : 1);
      React.act(() => recovery().click());
      assert.deepEqual(writes, [[15, "reset", ""]]);
      assert.equal(saved, "column");
      assert.equal(recovery(), null);
      assert.equal(dom.window.document.querySelector("li").textContent, "One");
      React.act(render);
      assert.equal(dom.window.document.querySelector("li").textContent, "One");
      assert.equal(recovery(), null);
      const menu = dom.window.document.querySelector('button[aria-label="Group actions: Backlog"]');
      React.act(() => menu.click());
      const hide = [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "Hide this group");
      assert.ok(hide);
      React.act(() => hide.click());
      assert.equal(dom.window.document.querySelectorAll("li").length, 0);
      assert.ok(recovery());
      enabled = false;
      React.act(render);
      assert.equal(recovery(), null);
      assert.equal(dom.window.document.querySelector('[aria-label="Group actions: Backlog"]'), null);
      assert.equal(dom.window.document.querySelector("li").textContent, "One");
    } finally {
      React.act(() => root.unmount());
      global.window = previous.window;
      global.document = previous.document;
      global.IS_REACT_ACT_ENVIRONMENT = previous.act;
      dom.window.close();
    }
  });
}
