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
const audioButton = read("src/components/RTE/Components/AudioButton.tsx");
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
const { extractTaskProperties, mergeMobileCreateTaskWriterResult } = jiti(
  path.join(root, "src/utils/aiWriterUtils.ts"),
);
const { MOBILE_AI_TASK_WRITER_FOCUS } = jiti(
  path.join(root, "src/models/CreateTaskModalModels/model.ts"),
);
const { mobileMicPresentation } = jiti(
  path.join(
    root,
    "src/components/RTE/Components/mobileAudioButtonPresentation.ts",
  ),
);

test("mobile plus opens the classic create form", () => {
  assert.match(
    mobileButton,
    /onClick=\{\(\) => setCreateTaskModal\(\{ show: true \}\)\}/,
  );
  assert.doesNotMatch(mobileButton, /defaultEditMode: "Description-ai"/);
});

test("mobile create writer matches the approved stripped-down hierarchy", () => {
  const introStart = writerContainer.indexOf("const mobileCreateIntroEl");
  const introEnd = writerContainer.indexOf("useEffect(() =>", introStart);
  const intro = writerContainer.slice(introStart, introEnd);
  const composerStart = writerContainer.indexOf(
    "{isMobileCreateFlow ? (\n            <div\n              data-mobile-task-writer-composer",
  );
  const composerEnd = writerContainer.indexOf("</AppSheet>", composerStart);
  const composer = writerContainer.slice(composerStart, composerEnd);

  assert.ok(introStart >= 0 && introEnd > introStart);
  assert.doesNotMatch(intro, />AI task writer</);
  assert.doesNotMatch(intro, />\s*Classic form\s*</);
  assert.equal((intro.match(/rounded-\[4px\] bg-cardBackground/g) || []).length, 3);
  assert.doesNotMatch(intro, /rounded-full|border-border-light-gray-thin/);
  assert.match(
    writerContainer,
    /detent=\{isMobileCreateFlow \? "content-height" : "full-height"\}/,
  );
  assert.match(
    writerContainer,
    /isMobileCreateFlow[\s\S]*?"rounded-t-\[5px\] bg-modalBackground shadow-md"/,
  );
  assert.match(composer, /data-mobile-task-writer-field/);
  assert.match(composer, /rounded-lg bg-newcomment-well/);
  assert.doesNotMatch(composer, /data-mobile-task-writer-field[\s\S]{0,180}?\bborder\b/);
  assert.match(composer, /Skip AI, use the classic form/);
  assert.match(composer, /onClick=\{mobileCreateTask!\.onClassicForm\}/);
  assert.match(
    writerContainer,
    /\{!isLoading && !isMobileCreateFlow && \([\s\S]*?<Paperclip/,
  );
});

test("mobile create dictation keeps one recorder and uses the approved purple primary", () => {
  assert.equal((writerContainer.match(/<AudioButton/g) || []).length, 1);
  assert.match(
    writerContainer,
    /mobilePrimaryTone=\{isMobileCreateFlow \? "ai" : undefined\}/,
  );
  assert.match(
    audioButton,
    /mobilePrimaryTone === "ai"[\s\S]*?bg-hypertasks-ai-purple text-white/,
  );

  const base = {
    isMobileCreateComment: false,
    isMobileTaskWriter: true,
    isMobileNewTask: false,
    isMobileAiChat: false,
    isProcessing: false,
  };
  const approved = mobileMicPresentation({ ...base, primaryTone: "ai" });
  const unchangedDefault = mobileMicPresentation(base);
  assert.match(approved.className, /bg-hypertasks-ai-purple/);
  assert.doesNotMatch(approved.className, /bg-white-black/);
  assert.match(unchangedDefault.className, /bg-white-black/);
});

test("mobile create submit stays trimmed and single-flight", () => {
  assert.match(
    writerContainer,
    /isLoading \|\|[\s\S]*?isByokBlocked \|\|[\s\S]*?isMobileCreateFlow &&[\s\S]*?mobileCreateRequestPendingRef\.current \|\|[\s\S]*?currentDisplayResponse/,
  );
  assert.match(writerContainer, /if \(!promptToUse\.trim\(\)\) return;/);
  assert.match(
    writerContainer,
    /if \(isMobileCreateFlow\) mobileCreateRequestPendingRef\.current = true;[\s\S]*?try \{[\s\S]*?await sendAIRequest\([\s\S]*?catch \(error\) \{[\s\S]*?toast\.error\("Could not send the request\. Try again\."\);[\s\S]*?finally \{[\s\S]*?mobileCreateRequestPendingRef\.current = false;/,
  );
  assert.match(
    writerContainer,
    /appliedCreateResponseRef\.current === currentResponseItem\.id/,
  );
});

test("mobile AI result merges into one direct-create snapshot", () => {
  const existingPriority = { priority_index: 2, Priority_Value: "High" };
  const generatedPriority = { priority_index: 3, Priority_Value: "Low" };
  const generatedSection = {
    sectionId: 99,
    sectionTitle: "In Progress",
    position: "top",
  };
  const generatedAssignee = { id: 7, displayName: "QA Agent" };
  const current = {
    title: "",
    description: "<p></p>",
    assignees: [],
    attachments: [],
    status: { sectionId: 12, sectionTitle: "Backlog", position: "top" },
    priority: existingPriority,
  };

  const merged = mergeMobileCreateTaskWriterResult(
    current,
    {
      title: "Generated task",
      description: "<p>Generated description</p>",
      priority: generatedPriority,
      status: generatedSection,
      assignees: [generatedAssignee],
    },
    [
      {
        id: "generated-file",
        file: { name: "proof.png", size: 12, type: "image/png" },
        preview: "https://files.hypertask.app/proof.png",
      },
    ],
    12,
  );

  assert.equal(merged.title, "Generated task");
  assert.equal(merged.description, "<p>Generated description</p>");
  assert.equal(merged.priority, existingPriority, "an explicit form value wins");
  assert.deepEqual(merged.status, generatedSection, "AI may replace the opening section");
  assert.deepEqual(merged.assignees, [generatedAssignee]);
  assert.equal(merged.attachments[0].file.source, "https://files.hypertask.app/proof.png");
  assert.match(
    createTaskModal,
    /CtrlEnterHandler\("Save", mergedFormValues\)/,
    "the merged snapshot must enter the existing create-and-navigate path",
  );
  assert.doesNotMatch(
    createTaskModal,
    /setTaskWriterFilled\(changed\);\s*showClassicForm\(\)/,
  );
});

test("mobile AI result preserves edits made in the classic form", () => {
  const current = {
    title: "Keep my title",
    description: "<p>Keep my description</p>",
    assignees: [{ id: 6, displayName: "Valentin" }],
    attachments: [{ id: 1, file: { source: "existing" } }],
    status: { sectionId: 77, sectionTitle: "Doing", position: "top" },
  };
  const merged = mergeMobileCreateTaskWriterResult(
    current,
    {
      title: "Generated title",
      description: "<p>Generated description</p>",
      status: { sectionId: 99, sectionTitle: "Done", position: "top" },
      assignees: [{ id: 7, displayName: "QA Agent" }],
    },
    undefined,
    12,
  );

  assert.equal(merged.title, current.title);
  assert.equal(merged.description, current.description);
  assert.equal(merged.status, current.status);
  assert.equal(merged.assignees, current.assignees);
  assert.equal(merged.attachments, current.attachments);
});

test("board create entry points follow the AI-first flag", async () => {
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
  let aiFirstTaskWriterEnabled = false;
  const moduleMocks = new Map([
    [path.join(root, "src/hooks/useFlag.tsx"), {
      useFlag: () => aiFirstTaskWriterEnabled,
    }],
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
    const renderHarness = async (isMobile) => {
      await React.act(async () => {
        reactRoot.render(
          React.createElement(
            MobileViewContext.Provider,
            { value: isMobile },
            React.createElement(Harness),
          ),
        );
      });
    };
    const clickColumnPlus = async () => {
      await React.act(async () => {
        container.querySelector(".create-new-task-button").click();
      });
    };
    const dispatchShortcut = async ({ key, code, keyCode, ctrlKey = false }) => {
      const shortcut = new KeyboardEvent("keydown", {
        key,
        code,
        ctrlKey,
        bubbles: true,
      });
      Object.defineProperty(shortcut, "keyCode", { value: keyCode });
      await React.act(async () => document.dispatchEvent(shortcut));
    };

    await renderHarness(true);
    await clickColumnPlus();
    await dispatchShortcut({ key: "c", code: "KeyC", keyCode: 67 });
    await dispatchShortcut({ key: "j", code: "KeyJ", keyCode: 74, ctrlKey: true });

    aiFirstTaskWriterEnabled = true;
    await renderHarness(true);
    await clickColumnPlus();
    await dispatchShortcut({ key: "c", code: "KeyC", keyCode: 67 });

    await renderHarness(false);
    await clickColumnPlus();
    await dispatchShortcut({ key: "c", code: "KeyC", keyCode: 67 });

    assert.deepEqual(createCalls, [
      { payload: sectionPayload, defaultEditFocus: undefined },
      { payload: sectionPayload, defaultEditFocus: undefined },
      { payload: sectionPayload, defaultEditFocus: MOBILE_AI_TASK_WRITER_FOCUS },
      { payload: sectionPayload, defaultEditFocus: MOBILE_AI_TASK_WRITER_FOCUS },
      { payload: sectionPayload, defaultEditFocus: MOBILE_AI_TASK_WRITER_FOCUS },
      { payload: sectionPayload, defaultEditFocus: undefined },
      { payload: sectionPayload, defaultEditFocus: undefined },
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
  assert.match(createTaskModal, /mergeMobileCreateTaskWriterResult\(/);
  assert.match(createTaskModal, /responseProjectId !== currentProjectId/);
  assert.match(createTaskModal, /setTaskWriterFilled\(true\)/);
  assert.match(
    createTaskModal,
    /return \(await CtrlEnterHandler\("Save", mergedFormValues\)\) === true/,
  );
  assert.match(
    writerContainer,
    /applyCreateTaskResult\([\s\S]*?\.then\(\(handled\) => \{[\s\S]*?if \(handled\) clearHistory\(\)/,
  );
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
  assert.match(
    createTaskModal,
    /formValues\.status\.sectionId !== openingSectionIdRef\.current/,
  );
  assert.match(
    createTaskModal,
    /hasOpenedClassicForm &&[\s\S]*?mobileCreateFormProperties\.length > 0/,
  );
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
  assert.doesNotMatch(properties, /Filled in by the AI task writer/);
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
