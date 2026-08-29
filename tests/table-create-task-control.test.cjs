const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
      jsx: true,
    })
  : jitiModule(__filename, { interopDefault: true, cache: false, jsx: true });
const {
  createTaskFromTableSelection,
  getTableCreateTaskButtonLabelsForSelection,
  resolveTableCreateTaskSectionPayload,
  tableSectionId,
} = jiti(
  path.join(
    root,
    "src/components/PageComponents/Kanban/TableView/tableCreateTask.ts",
  ),
);
const {
  getTableCreateTaskControlProps,
  TableCreateTaskControl,
} = jiti(
  path.join(
    root,
    "src/components/PageComponents/Kanban/TableView/TableCreateTaskControl.tsx",
  ),
);

test("mouse and keyboard task creation use the selected table column", () => {
  const sections = [
    { sectionId: 10, section_title: "Inbox" },
    { sectionId: 20, section_title: "Doing" },
  ];
  const calls = [];
  const toggleCreateTaskGlobally = (payload) => calls.push(payload);

  createTaskFromTableSelection({
    hasCurrentProject: true,
    selectedRow: { type: "task", sid: 20 },
    sections,
    toggleCreateTaskGlobally,
  });
  createTaskFromTableSelection({
    hasCurrentProject: true,
    selectedRow: { type: "more", sid: 10 },
    sections,
    toggleCreateTaskGlobally,
  });
  createTaskFromTableSelection({
    hasCurrentProject: true,
    selectedRow: undefined,
    sections,
    toggleCreateTaskGlobally,
  });
  createTaskFromTableSelection({
    hasCurrentProject: false,
    selectedRow: { type: "task", sid: 20 },
    sections,
    toggleCreateTaskGlobally,
  });

  assert.deepEqual(calls, [
    { sectionId: 20, sectionTitle: "Doing", position: "bottom" },
    { sectionId: 10, sectionTitle: "Inbox", position: "bottom" },
  ]);
  assert.equal(resolveTableCreateTaskSectionPayload(30, sections), undefined);
  assert.equal(resolveTableCreateTaskSectionPayload("flat", sections), undefined);
  assert.equal(resolveTableCreateTaskSectionPayload("i0", sections), undefined);
  assert.deepEqual(resolveTableCreateTaskSectionPayload("20", sections), {
    sectionId: 20,
    sectionTitle: "Doing",
    position: "bottom",
  });
  assert.equal(
    tableSectionId({ sectionId: "20", section_title: "Doing" }),
    "20",
  );
  assert.deepEqual(
    resolveTableCreateTaskSectionPayload("20", [
      { sectionId: "20", section_title: "Doing" },
    ]),
    { sectionId: 20, sectionTitle: "Doing", position: "bottom" },
  );
  assert.deepEqual(
    resolveTableCreateTaskSectionPayload("001", [
      { sectionId: "001", section_title: "Padded" },
      { sectionId: "1", section_title: "One" },
    ]),
    { sectionId: 1, sectionTitle: "Padded", position: "bottom" },
  );
  assert.equal(
    resolveTableCreateTaskSectionPayload("1", [
      { sectionId: "001", section_title: "Padded" },
    ]),
    undefined,
  );
  assert.equal(
    resolveTableCreateTaskSectionPayload("9007199254740992", sections),
    undefined,
  );
  assert.deepEqual(
    resolveTableCreateTaskSectionPayload(0, [
      { sectionId: null, section_title: "Unsectioned" },
      { sectionId: 0, section_title: "Zero" },
    ]),
    { sectionId: 0, sectionTitle: "Zero", position: "bottom" },
  );
  assert.deepEqual(
    resolveTableCreateTaskSectionPayload(42, [{ id: 42, section_title: "Backlog" }]),
    { sectionId: 42, sectionTitle: "Backlog", position: "bottom" },
  );
});

test("table create control labels match the selected-row context", () => {
  const sections = [{ sectionId: 20, section_title: "Doing" }];
  assert.deepEqual(getTableCreateTaskButtonLabelsForSelection({ sid: 20 }, sections), {
    ariaLabel: "Create task in the selected column",
    title: "Create task in the selected column (C)",
  });
  assert.deepEqual(getTableCreateTaskButtonLabelsForSelection({ sid: "flat" }, sections), {
    ariaLabel: "Create task",
    title: "Create task (C)",
  });
});

test("the rendered table create control follows live selection and project scope", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const rows = [{ sid: 20 }, { sid: 10 }];
  const sections = [
    { sectionId: 20, section_title: "Doing" },
    { sectionId: 10, section_title: "Inbox" },
  ];
  const createCalls = [];
  const toggleCreateTaskGlobally = (payload) => createCalls.push(payload);
  const renderControl = (
    currentProject,
    selectedIndex,
    controlRows = rows,
    controlSections = sections,
  ) =>
    React.createElement(
      TableCreateTaskControl,
      getTableCreateTaskControlProps({
        currentProject,
        rows: controlRows,
        selectedIndex,
        sections: controlSections,
        toggleCreateTaskGlobally,
      }),
    );
  let act;
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    ({ act } = React);
    const { createRoot } = require("react-dom/client");
    const container = document.getElementById("root");
    reactRoot = createRoot(container);

    await act(async () => {
      reactRoot.render(
        renderControl({ id: 15 }, 0),
      );
    });
    const button = container.querySelector("button");
    assert.ok(button);
    assert.equal(button.getAttribute("aria-label"), "Create task in the selected column");
    assert.equal(button.getAttribute("title"), "Create task in the selected column (C)");
    assert.equal(button.querySelector("span")?.textContent, "New task");
    await act(async () => button.click());
    assert.deepEqual(createCalls, [
      { sectionId: 20, sectionTitle: "Doing", position: "bottom" },
    ]);

    await act(async () => {
      reactRoot.render(renderControl({ id: 15 }, 1));
    });
    const secondButton = container.querySelector("button");
    assert.ok(secondButton);
    await act(async () => secondButton.click());
    assert.deepEqual(createCalls, [
      { sectionId: 20, sectionTitle: "Doing", position: "bottom" },
      { sectionId: 10, sectionTitle: "Inbox", position: "bottom" },
    ]);

    await act(async () => {
      reactRoot.render(renderControl({ id: 15 }, 0, [], []));
    });
    const emptyButton = container.querySelector("button");
    assert.ok(emptyButton);
    assert.equal(emptyButton.disabled, true);
    assert.equal(emptyButton.getAttribute("aria-label"), "Create task");
    await act(async () => emptyButton.click());
    assert.equal(createCalls.length, 2);

    await act(async () => {
      reactRoot.render(renderControl(null, 0));
    });
    assert.equal(container.innerHTML, "");
  } finally {
    if (reactRoot && act) await act(async () => reactRoot.unmount());
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    dom.window.close();
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});
