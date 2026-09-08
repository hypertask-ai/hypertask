const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const jitiOptions = {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
};
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, { ...jitiOptions, moduleCache: false })
  : jitiModule(__filename, { ...jitiOptions, cache: false });
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

// HTPR-6175: with quick entry on, the New task button opens an inline box that
// saves on Enter and stays open for the next card.
test("table quick entry saves on Enter, keeps the box open, and keeps the target column", async () => {
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
  const modalCalls = [];
  const quickCalls = [];
  let quickResult = true;
  const quickCreateTask = async (title, sectionId, sectionTitle) => {
    quickCalls.push({ title, sectionId, sectionTitle });
    return quickResult;
  };
  const renderControl = (selectedIndex) =>
    React.createElement(
      TableCreateTaskControl,
      getTableCreateTaskControlProps({
        currentProject: { id: 15 },
        rows,
        selectedIndex,
        sections,
        toggleCreateTaskGlobally: (payload) => modalCalls.push(payload),
        quickEntryEnabled: true,
        quickCreateTask,
      }),
    );
  const pressEnter = async (act, input) => {
    await act(async () => {
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      );
    });
  };
  const type = async (act, input, value) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  let act;
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no layout, so the box's scroll-into-view call needs a stub.
    dom.window.Element.prototype.scrollIntoView = () => {};
    ({ act } = React);
    const { createRoot } = require("react-dom/client");
    const container = document.getElementById("root");
    reactRoot = createRoot(container);

    await act(async () => reactRoot.render(renderControl(0)));
    await act(async () => container.querySelector("button").click());

    // The inline box replaces the button, and no modal was opened.
    const input = container.querySelector("input");
    assert.ok(input);
    assert.equal(container.querySelector("button"), null);
    assert.deepEqual(modalCalls, []);

    // Enter saves against the column that was selected when the box opened.
    await type(act, input, "First card");
    await pressEnter(act, input);
    assert.deepEqual(quickCalls, [
      { title: "First card", sectionId: 20, sectionTitle: "Doing" },
    ]);
    // Box stays open and clears, ready for the next card.
    assert.ok(container.querySelector("input"));
    assert.equal(container.querySelector("input").value, "");

    // Moving the selection to another column must not redirect the open box.
    await act(async () => reactRoot.render(renderControl(1)));
    await type(act, container.querySelector("input"), "Second card");
    await pressEnter(act, container.querySelector("input"));
    assert.deepEqual(quickCalls[1], {
      title: "Second card",
      sectionId: 20,
      sectionTitle: "Doing",
    });

    // A failed save keeps the typed title instead of losing it.
    quickResult = false;
    await type(act, container.querySelector("input"), "Kept on failure");
    await pressEnter(act, container.querySelector("input"));
    assert.equal(quickCalls.length, 3);
    assert.equal(container.querySelector("input").value, "Kept on failure");

    // Escape closes the box and preserves the draft for reopening.
    await act(async () => {
      container.querySelector("input").dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    assert.equal(container.querySelector("input"), null);
    assert.ok(container.querySelector("button"));
    await act(async () => container.querySelector("button").click());
    assert.equal(container.querySelector("input").value, "Kept on failure");

    // Two Enter events in one render still produce only one request.
    let finishCreate;
    quickResult = new Promise((resolve) => {
      finishCreate = resolve;
    });
    await type(act, container.querySelector("input"), "Only once");
    await act(async () => {
      const input = container.querySelector("input");
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    assert.equal(quickCalls.length, 4);
    await act(async () => {
      finishCreate(true);
      await quickResult;
    });
    assert.equal(container.querySelector("input").value, "");
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
