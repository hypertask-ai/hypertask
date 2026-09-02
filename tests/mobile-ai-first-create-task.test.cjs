const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const mobileButton = read("src/components/Global/MobileCreateTaskButton.tsx");
const createTaskModal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
const writerContainer = read(
  "src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer.tsx",
);
const createBody = read(
  "src/components/Modals/CreateTaskGloballyModal/CreateTaskModalBody.tsx",
);
const properties = read(
  "src/components/Modals/CreateTaskGloballyModal/TaskInfoColumnGloballyCreate.tsx",
);
const assignees = read(
  "src/components/Modals/CreateTaskGloballyModal/AssigneesTaskGlobal/AssigneesContainerCreateTaskGlobally.tsx",
);
const startDate = read("src/components/Modals/StartDate/index.tsx");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.DOMParser = dom.window.DOMParser;
const { extractTaskProperties } = jiti(
  path.join(root, "src/utils/aiWriterUtils.ts"),
);
const { MOBILE_AI_TASK_WRITER_FOCUS } = jiti(
  path.join(root, "src/models/CreateTaskModalModels/model.ts"),
);

test("mobile plus opens the create modal in AI task-writer mode", () => {
  assert.match(mobileButton, /defaultEditFocus: MOBILE_AI_TASK_WRITER_FOCUS/);
  assert.deepEqual(MOBILE_AI_TASK_WRITER_FOCUS, {
    defaultEditMode: "Description-ai",
    defaultFocus: "Description",
  });
});

test("mobile board section plus and C shortcut open the AI task writer", async () => {
  const testDom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/project/15",
  });
  const globalNames = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "MouseEvent",
    "KeyboardEvent",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previousGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(global, name),
    ]),
  );
  const moduleMocks = new Map([
    [path.join(root, "src/lib/state.tsx"), {
      useRecoilState: (atom) => React.useState(atom.default),
      useSetRecoilState: () => () => {},
    }],
    [path.join(root, "src/store/index.ts"), {
      activeItemAtom: { default: null },
      currentProjectAtom: { default: undefined },
    }],
    [path.join(root, "src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx"), {
      default: () => ({ createItem: () => {} }),
    }],
    [path.join(root, "src/hooks/RecoilRoot/useHypertasksRecoilStates.ts"), {
      default: () => ({ toggleCreateTaskGlobally }),
    }],
    [path.join(root, "src/lib/contexts/deviceContext.tsx"), {
      useDeviceContext: () => false,
    }],
    [path.join(root, "src/utils/helperFunctions/helperFunctions.ts"), {
      returnIfModalOrInputActive: () => false,
    }],
    [path.join(root, "src/hooks/MultiPages/Route/useHypertasksNavigate.ts"), {
      default: () => ({ navigate: () => {} }),
    }],
    [path.join(root, "src/components/Common/Tooltip.tsx"), {
      default: () => null,
    }],
    [require.resolve("next/navigation"), { useRouter: () => ({}) }],
    [require.resolve("jotai"), { useStore: () => ({ get: () => null }) }],
  ]);
  const previousModules = new Map(
    [...moduleMocks].map(([filename]) => [filename, require.cache[filename]]),
  );
  const createCalls = [];
  const sectionPayload = {
    sectionId: 9190,
    sectionTitle: "Backlog",
    position: "top",
  };
  function toggleCreateTaskGlobally(payload, defaultEditFocus) {
    createCalls.push({ payload, defaultEditFocus });
  }
  let reactRoot;

  try {
    global.window = testDom.window;
    global.document = testDom.window.document;
    global.navigator = testDom.window.navigator;
    global.HTMLElement = testDom.window.HTMLElement;
    global.MouseEvent = testDom.window.MouseEvent;
    global.KeyboardEvent = testDom.window.KeyboardEvent;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    for (const [filename, exports] of moduleMocks) {
      require.cache[filename] = {
        id: filename,
        filename,
        loaded: true,
        exports,
      };
    }

    const hookJiti = createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      jsx: true,
    });
    const useSections = hookJiti(
      path.join(root, "src/hooks/Homepage/useSections.ts"),
    ).default;
    const NewTaskButton = hookJiti(
      path.join(
        root,
        "src/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton.tsx",
      ),
    ).default;
    const { MobileViewContext } = hookJiti(
      path.join(root, "src/lib/contexts/mobileContext.tsx"),
    );
    const Harness = () => {
      const { createTaskAt } = useSections({
        items: [],
        active: true,
        index: 0,
        title: "Backlog",
        sectionId: 9190,
        projectId: 15,
      });
      return React.createElement(NewTaskButton, {
        buttonPosition: "top",
        createTaskAt,
        sectionPayload,
      });
    };
    const container = document.getElementById("root");
    const { createRoot } = require("react-dom/client");
    reactRoot = createRoot(container);
    await React.act(async () => {
      reactRoot.render(
        React.createElement(
          MobileViewContext.Provider,
          { value: true },
          React.createElement(Harness),
        ),
      );
    });

    await React.act(async () => {
      container.querySelector(".create-new-task-button").click();
    });
    const shortcut = new KeyboardEvent("keydown", {
      key: "c",
      code: "KeyC",
      bubbles: true,
    });
    Object.defineProperty(shortcut, "keyCode", { value: 67 });
    await React.act(async () => document.dispatchEvent(shortcut));

    assert.deepEqual(createCalls, [
      { payload: sectionPayload, defaultEditFocus: MOBILE_AI_TASK_WRITER_FOCUS },
      { payload: sectionPayload, defaultEditFocus: MOBILE_AI_TASK_WRITER_FOCUS },
    ]);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const [filename, previous] of previousModules) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    testDom.window.close();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor === undefined) delete global[name];
      else Object.defineProperty(global, name, descriptor);
    }
  }
});

test("mobile create uses the shared writer and applies its response before save", () => {
  assert.match(createTaskModal, /projectAssignees=\{projectAssignees\}/);
  assert.match(createTaskModal, /mobileCreateTask=\{mobileCreateTask\}/);
  assert.match(
    createTaskModal,
    /applyCreateTaskResult=\{applyCreateTaskResult\}/,
  );
  assert.match(
    createTaskModal,
    /if \(!formValues\.title\.trim\(\) && result\.title/,
  );
  assert.match(
    createTaskModal,
    /if \(!formValues\.priority && result\.priority/,
  );
  assert.match(createTaskModal, /if \(!formValues\.dueDate && result\.dueDate/);
  assert.match(
    createTaskModal,
    /if \(!formValues\.startDate && result\.startDate/,
  );
  assert.match(createTaskModal, /responseProjectId !== currentProjectId/);
  assert.match(createTaskModal, /setTaskWriterFilled\(changed\)/);
  assert.match(
    writerContainer,
    /!isMobileCreateFlow && !isLoading && currentDisplayResponse/,
  );
  assert.match(
    writerContainer,
    /const aiOptionsEl[\s\S]*?!isMobileCreateFlow && !isLoading && currentDisplayResponse/,
  );
  assert.match(writerContainer, /!isMobileCreateFlow \|\|/);
  assert.match(
    writerContainer,
    /appliedCreateResponseRef\.current === currentResponseItem\.id/,
  );
  assert.match(createTaskModal, /const currentProjectId = projectForContext\?\.id/);
});

test("classic form carries content back into the shared writer", () => {
  assert.match(writerContainer, /Already in the form/);
  assert.match(writerContainer, /What should the writer add or change\?/);
  assert.match(createTaskModal, /onClassicForm: showClassicForm/);
  assert.match(createTaskModal, /const mobileCreateFormSummary = hasOpenedClassicForm/);
  assert.match(createTaskModal, /formSummary: mobileCreateFormSummary/);
  assert.match(properties, /onClick=\{property\.onClick\}/);
  assert.doesNotMatch(
    writerContainer,
    /onClick=\{mobileCreateTask\.onClassicForm\}\s*className="[^"]*(?:border-thin|bg-cardBackground)/,
  );
  assert.doesNotMatch(
    writerContainer,
    /rounded-sm bg-modalBackground px-2 py-1 text-meta text-white-black/,
  );
});

test("mobile classic properties appear before the description and include start date", () => {
  assert.match(
    createBody,
    /<TaskInfoColumnContainer[\s\S]*?<DescriptionCreateTaskModal \/>/,
  );
  for (const label of [
    "Board",
    "Section",
    "Priority",
    "Labels",
    "Due",
    "Size",
    "Start",
  ]) {
    assert.match(properties, new RegExp(`label: "${label}"`));
  }
  assert.match(properties, /<AssigneesContainerCreateTaskGlobally[\s\S]*?compact/);
  assert.match(assignees, /compact[\s\S]*?Assignee:/);
  assert.match(properties, /Filled in by the AI task writer/);
  assert.match(properties, /mode="Create"/);
  assert.match(properties, /<StartDateModal/);
  assert.doesNotMatch(properties, /min-h-11 rounded-sm bg-cardBackground/);
  assert.doesNotMatch(writerContainer, /min-h-11 rounded-sm bg-cardBackground/);
});

test("start-date selection stays local to create mode", () => {
  assert.match(startDate, /mode === "Update" && inViewObject\.taskId/);
});

test("malformed and foreign AI markers never escape the loaded board allowlists", () => {
  const result = extractTaskProperties(
    [
      '<h1 id="ai-generated-task-title">Generated title</h1>',
      '<span id="ai-generated-task-priority">2x</span>',
      '<span id="ai-generated-task-estimate">3</span>',
      '<span id="ai-generated-task-tags">foreign-label, label-good</span>',
      '<span id="ai-generated-task-status">99oops</span>',
      '<span id="ai-generated-task-assignees">foreign-user, 7</span>',
      '<span id="ai-generated-task-due-date">2026-02-30</span>',
      '<span id="ai-generated-task-start-date">2026-09-05</span>',
      "<p>Keep this description.</p>",
      "<p>Proposed properties: Priority High, Size S</p>",
    ].join(""),
    [{ id: "label-good", value: "Backend" }],
    [{ id: 12, section_title: "Triage" }],
    [
      { id: 7, displayName: "Valentin Yeo" },
      { id: "agent-good", displayName: "Build agent" },
    ],
  );

  assert.equal(result.priority, undefined);
  assert.equal(result.status, undefined);
  assert.deepEqual(
    result.tags?.map((tag) => tag.id),
    ["label-good"],
  );
  assert.deepEqual(
    result.assignees?.map((assignee) => assignee.id),
    [7],
  );
  assert.equal(result.dueDate, undefined);
  assert.equal(result.startDate?.getFullYear(), 2026);
  assert.equal(result.startDate?.getMonth(), 8);
  assert.equal(result.startDate?.getDate(), 5);
  assert.match(result.description, /Keep this description/);
  assert.doesNotMatch(result.description, /Proposed properties/);
});
