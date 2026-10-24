const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flag = "htpr-7544-ctrlj-sidebar-on-new-task";
const editFlag = "htpr-7337-edit-with-ai";
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (name === "@/lib/api/errorMessage") return load("src/lib/api/errorMessage.ts", {});
    if (name.startsWith("@/") || name.startsWith("./")) throw new Error(`Unstubbed dependency: ${name}`);
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}
const { isEmptyComposeTarget } = load("src/lib/ai/composeTaskTarget.ts");
const { taskDetailNavigationKeymap } = load("src/app/detail/[...slug]/taskDetailNavigationKeymap.ts", {
  "@/lib/configs/taskDetail.config": { default: {} },
  "@/lib/keyboard/archiveShortcutGuard": {},
  "@/lib/taskDetailArchiveNavigation": {},
  "@/lib/notifications/archiveShortcutNudge": {},
  "@/models/enums": { CommandMode: { Command: "command" } },
  "@/lib/constants/keyboard-handler": { KeyCodes: { J: 74 } },
});

async function detail(options, run) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-6859/43" });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [];
  let cleanupCompose;
  if (options.competingCompose && options.composeFirst) cleanupCompose = globalComposeListener(calls, dom, options.apple);
  const currentTask = options.task === null ? null : { id: 43, projectId: 6859, uniqueIndex: 43, title: "New Task", description_: { content: "<p></p>" }, ...options.task };
  const state = { currentTask, isRecording: options.recording ?? false,
    searchParams: new URLSearchParams(options.openRequest ? "newTaskAi=1" : ""),
    router: { replace: (url) => calls.push(["replace", url]) },
  };
  const commandContext = { ...state, editWithAiEnabled: options.editFlag ?? true,
    returnCurrentFocusedType: () => "Others", focusOn: () => {}, setEditMode: (mode) => calls.push(["mode", mode]),
    setShowCommands: (value) => calls.push(["new-task", value]),
  };
  const keyboard = (context, enabled) => ({ handleKeyDown: (event) => {
    const command = taskDetailNavigationKeymap({ ...commandContext, ...context, editWithAiEnabled: enabled }, event, options.apple ? event.metaKey : event.ctrlKey).find((item) => item.action === "aiWriter");
    if (command.matches()) command.run();
  } });
  const mocks = {
    "@/hooks/useFlag": { useFlag: (key) => key === flag ? options.enabled !== false : key === editFlag && options.editFlag !== false },
    "@/lib/flags/keys": { HTPR_7544_CTRLJ_SIDEBAR_ON_NEW_TASK_FLAG: flag, HTPR_7337_EDIT_WITH_AI_FLAG: editFlag },
    "@/lib/ai/composeTaskTarget": { isEmptyComposeTarget },
    "@/lib/state": { useRecoilValue: () => ({ taskId: 43 }) },
    "@/store": { inViewObjectAtom: "in-view" },
    "@/hooks/MultiPages/AIChat/useCommentToAiChat": { useCommentToAiChat: () => ({ editTicketWithAi: (id) => calls.push(["sidebar", id]) }) },
    "@/styles/taskDetail.scss": {},
    "./useTaskDetailState": { useTaskDetailState: () => state },
    "./useTaskDetailModals": { useTaskDetailModals: () => ({ isApple: options.apple ?? false }) },
    "./taskDetailKeyboard": { createTaskDetailKeyboard: keyboard },
    "./useTaskDetailInitialScroll": { useTaskDetailInitialScroll: () => ({}) },
    "./useLinkedCommentScroll": { useLinkedCommentScroll: () => {} },
    "./useTaskDetailReadiness": { useTaskDetailReadiness: ({ handleKeyDown }) => {
      React.useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
      }, [handleKeyDown]);
    } },
    "./TaskDetailPanels": { TaskDetailPanels: () => React.createElement("textarea", { id: "title-input", onKeyDown: (event) => {
      if (event.key === "j" && (event.ctrlKey || event.metaKey)) calls.push(["focused-handler"]);
    } }) },
  };
  for (const name of ["Navigation", "Command", "Comment", "Modal"]) {
    mocks[`./useTaskDetail${name}Actions`] = { [`useTaskDetail${name}Actions`]: () => ({}) };
  }
  const { default: TaskDetail } = load("src/app/detail/[...slug]/TaskDetailComp.tsx", mocks);
  const reactRoot = createRoot(document.getElementById("root"));
  const press = (init = {}) => {
    const event = new dom.window.KeyboardEvent("keydown", { key: "j", keyCode: 74, ctrlKey: !options.apple, metaKey: Boolean(options.apple), bubbles: true, cancelable: true, ...init });
    document.activeElement.dispatchEvent(event);
    return event;
  };
  try {
    await React.act(async () => reactRoot.render(React.createElement(TaskDetail, { embedded: options.embedded })));
    if (options.competingCompose && !options.composeFirst) cleanupCompose = globalComposeListener(calls, dom, options.apple);
    await run({ calls, press, dom });
  } finally {
    cleanupCompose?.();
    await React.act(async () => reactRoot.unmount());
    Object.assign(global, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
    dom.window.close();
  }
}

test("fresh task Ctrl+J opens only the existing sidebar on that task, including focused title/editor and Cmd+J", async () => {
  for (const apple of [false, true]) {
    for (const editFlag of [false, true]) {
      await detail({ apple, editFlag }, async ({ calls, press }) => {
        assert.equal(press().defaultPrevented, true);
        document.getElementById("title-input").focus();
        press();
        const editor = document.createElement("div");
        editor.className = "ProseMirror";
        editor.tabIndex = 0;
        document.body.append(editor);
        editor.focus();
        press();
        assert.deepEqual(calls, [["sidebar", 43], ["sidebar", 43], ["sidebar", 43]]);
        press({ repeat: true });
        assert.equal(calls.length, 3, "holding the key must not create more sessions");
      });
    }
  }
});

test("empty saved detail Ctrl+J wins over the global compose capture listener in either mount order", async () => {
  for (const apple of [false, true]) {
    for (const composeFirst of [false, true]) {
      for (const options of [{}, { enabled: false }, { task: { title: "Existing task" } }]) {
        await detail({ apple, composeFirst, competingCompose: true, ...options }, async ({ calls, press }) => {
          document.getElementById("title-input").focus();
          assert.equal(document.activeElement.id, "title-input");
          assert.equal(press({ code: "KeyJ" }).defaultPrevented, true);
          if (options.enabled === false || options.task) {
            assert.equal(calls.length, 1);
            assert.equal(calls[0][0], "global-palette");
            assert.equal(calls[0][1].paletteTab, "compose");
          } else {
            assert.deepEqual(calls, [["sidebar", 43]]);
          }
        });
      }
    }
  }
});

test("flag off and nonempty tasks keep the existing New Task route; old AI flag off keeps description-ai", async () => {
  for (const options of [{ enabled: false }, { task: { title: "Existing task" } }, { task: { description_: { content: "<p>Written already</p>" } } }, { embedded: true }]) {
    await detail(options, async ({ calls, press }) => {
      press();
      assert.deepEqual(calls, [["new-task", { show: true, mode: "command", paletteTab: "compose" }]]);
    });
  }
  await detail({ enabled: false, editFlag: false }, async ({ calls, press }) => {
    press();
    assert.deepEqual(calls, [["mode", "description-ai"]]);
  });
});

test("other shortcuts, open dialogs and chat composer are not intercepted", async () => {
  await detail({}, async ({ calls, press }) => {
    const plain = press({ ctrlKey: false });
    assert.equal(plain.defaultPrevented, false);
    assert.deepEqual(calls, []);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    press();
    assert.equal(calls.some(([kind]) => kind === "sidebar"), false);
    dialog.remove();
    const panel = document.createElement("div");
    panel.setAttribute("data-ai-chat-panel", "");
    const composer = document.createElement("textarea");
    panel.append(composer);
    document.body.append(panel);
    composer.focus();
    calls.length = 0;
    press();
    assert.equal(calls.some(([kind]) => kind === "sidebar"), false);
  });
});

test("board Ctrl+J still invokes its unchanged New Task writer with either flag mode", () => {
  const file = ts.createSourceFile("useSections.ts", read("src/hooks/Homepage/useSections.ts"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let branch;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(file).includes("e.keyCode === KeyCodes.J")) branch = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(branch);
  assert.doesNotMatch(read("src/hooks/Homepage/useSections.ts"), /HTPR_7544|htpr-7544/);
  const dom = new JSDOM("<body tabindex='0'></body>");
  for (const enabled of [false, true]) {
    const calls = [];
    const compiled = ts.transpileModule(`if (${branch.expression.getText(file)}) ${branch.thenStatement.getText(file)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const handler = new Function("e", "KeyCodes", "document", "isApple", "createTaskAt", "setKeypressed", "sectionId", "title", "ctrlJSidebarOnNewTask", "blockLegacyCtrlJ", compiled);
    handler({ keyCode: 74, key: "j", ctrlKey: true, preventDefault: () => calls.push("prevented") }, { J: 74 }, dom.window.document, false, (...args) => calls.push(args), () => {}, 7, "To Do", enabled, false);
    assert.deepEqual(calls, ["prevented", ["top", { sectionId: 7, sectionTitle: "To Do", position: "top" }, { defaultEditMode: "Description-ai", defaultFocus: "Description" }]]);
  }
  dom.window.close();
});

test("flag is a client-safe improvement released to Everyone with risk metadata", () => {
  const definition = load(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length);
});

function draftHandoff(enabled, create, calls, dom, apple = false, options = {}) {
  const source = read("src/components/Modals/CreateTaskGloballyModal/CreateTaskModalBody.tsx");
  const file = ts.createSourceFile("CreateTaskModalBody.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect" && node.arguments[0]?.getText(file).includes("const openNewTaskSidebar")) effect = node.arguments[0].getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(effect);
  const compiled = ts.transpileModule(`const effect = ${effect};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("ctrlJSidebarOnNewTask", "window", "document", "isApple", "isRecording", "showAssignModal", "showConfirmationModal", "sidebarHandoffPending", "uploadInProgress", "formValues", "setUploadInProgress", "CreateTaskAndDescription", "router", "closeHandler", "toast", "_mbl", "closeBackDismissBeforeNavigation", "PlanLimitRefusal", `${compiled}; return effect();`)(
    enabled, dom.window, dom.window.document, apple, false, false, false, { current: false }, false,
    options.formValues ?? { currentProject: { id: 6859 }, status: { sectionId: 7 }, title: "" },
    (value) => calls.push(["busy", value]), create, options.router ?? { push: (url) => calls.push(["navigate", url]) },
    options.closeHandler ?? ((save) => calls.push(["close", save])), { error: () => calls.push(["error"]) },
    options.mobile ?? false, load("src/lib/mobile/backDismiss.ts").closeBackDismissBeforeNavigation, load("src/lib/planLimitsClient.ts").PlanLimitRefusal,
  );
}

test("C's unsaved new task screen saves exactly once then hands off to its detail sidebar", async () => {
  const dom = new JSDOM("<div id='createTaskModal'><textarea></textarea></div>");
  const calls = [];
  let finish;
  const created = new Promise((resolve) => { finish = resolve; });
  const cleanup = draftHandoff(true, (...args) => { calls.push(["save", ...args]); return created; }, calls, dom);
  const press = () => dom.window.document.querySelector("textarea").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true }));
  try {
    assert.equal(press(), false);
    press();
    assert.equal(calls.filter(([kind]) => kind === "save").length, 1);
    finish("/detail/project-6859/43");
    await created;
    await Promise.resolve();
    press();
    assert.deepEqual(calls, [["busy", true], ["save", undefined, "New Task"], ["navigate", "/detail/project-6859/43?newTaskAi=1"], ["close", true], ["busy", false]]);
  } finally { cleanup(); dom.window.close(); }
  await detail({ openRequest: true, task: { title: "Typed title" } }, async ({ calls }) => {
    assert.deepEqual(calls, [["replace", "/detail/project-6859/43"], ["sidebar", 43]]);
  });
  await detail({ openRequest: true, enabled: false }, async ({ calls }) => assert.deepEqual(calls, []));
});

test("phone handoff waits for armed back-dismiss cleanup with or without loaded section defaults", { timeout: 5000 }, async () => {
  for (const sectionReady of [true, false]) {
    const dom = new JSDOM("<div id='createTaskModal'><textarea id='title-input-modal'></textarea></div>", { url: "https://app.hypertask.ai/project?id=7049" });
    dom.window.innerWidth = 390;
    const calls = [];
    const { armBackDismiss } = load("src/lib/mobile/backDismiss.ts");
    const disarm = armBackDismiss(dom.window, { key: "createTaskModal", onBack: () => calls.push(["back-dismiss"]) });
    const popped = new Promise((resolve) => dom.window.addEventListener("popstate", resolve, { once: true }));
    const cleanup = draftHandoff(true, async (...args) => {
      calls.push(["save", ...args]);
      return "/detail/project-7049/43";
    }, calls, dom, false, {
      mobile: true,
      formValues: { currentProject: { id: 7049 }, title: "", status: sectionReady ? { sectionId: 19409 } : undefined },
      closeHandler: (saved) => {
        calls.push(["close", saved]);
        dom.window.setTimeout(() => { dom.window.document.getElementById("createTaskModal").remove(); disarm(); }, 10);
      },
      router: { push: (url) => { calls.push(["navigate", url]); dom.window.history.pushState({}, "", url); } },
    });
    try {
      assert.equal(dom.window.history.state.createTaskModal, true);
      const title = dom.window.document.getElementById("title-input-modal");
      title.focus();
      assert.equal(dom.window.document.activeElement, title);
      const event = new dom.window.KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true });
      assert.equal(title.dispatchEvent(event), false);
      assert.equal(calls.filter(([kind]) => kind === "save").length, 1, "Ctrl+J must save even before section defaults arrive");
      await popped;
      await Promise.resolve();
      assert.equal(dom.window.location.pathname + dom.window.location.search, "/detail/project-7049/43?newTaskAi=1");
      assert.deepEqual(calls, [["busy", true], ["save", undefined, "New Task"], ["close", true], ["navigate", "/detail/project-7049/43?newTaskAi=1"], ["busy", false]]);
      assert.equal(dom.window.history.state.createTaskModal, undefined);
      assert.equal(dom.window.document.getElementById("createTaskModal"), null);
    } finally { cleanup(); disarm(); dom.window.close(); }
  }
});

test("unsaved form flag off leaves its handler alone; failed save retains the draft and permits retry", async () => {
  for (const enabled of [false, true]) {
    const dom = new JSDOM("<div id='createTaskModal'><textarea></textarea></div>");
    const calls = [];
    const cleanup = draftHandoff(enabled, async () => { calls.push(["save"]); throw new Error("Unavailable"); }, calls, dom);
    try {
      for (let i = 0; i < 2; i += 1) {
        dom.window.document.querySelector("textarea").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true }));
        await Promise.resolve();
      }
      assert.equal(calls.filter(([kind]) => kind === "save").length, enabled ? 2 : 0);
      assert.equal(calls.filter(([kind]) => kind === "error").length, enabled ? 2 : 0);
      assert.equal(calls.some(([kind]) => kind === "navigate" || kind === "close"), false);
    } finally { cleanup?.(); dom.window.close(); }
  }
});

function composePaletteListener(enabled, calls, dom, apple) {
  const file = ts.createSourceFile("TiptapCreateTaskModal.tsx", read("src/components/RTE/TiptapCreateTaskModal.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const captureSelection = [];
  function visit(node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(file) === "composeShortcutCapture")) captureSelection.push(node.getText(file));
    if (ts.isIfStatement(node) && node.expression.getText(file) === "ctrlJSidebarOnNewTask") captureSelection.push(node.getText(file));
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect" && node.arguments[0]?.getText(file).includes("const openNewTask =")) effect = node.arguments[0].getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(effect);
  const compiled = ts.transpileModule(`${captureSelection.join("\n")}\nconst effect = ${effect};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const { isComposePaletteShortcut } = load("src/lib/constants/commandCenterShortcut.ts");
  return new Function("ctrlJSidebarOnNewTask", "window", "newTaskWindow", "isComposePaletteShortcut", "isApple", "pathname", "setCommands", "CommandMode", "projectForContext", "closeComposedTaskForm", `${compiled}; return effect();`)(
    enabled, dom.window, true, isComposePaletteShortcut, apple, "/project",
    (value) => calls.push(["palette", value]), { Command: "command" }, { id: 6859 }, () => {},
  );
}

function globalComposeListener(calls, dom, apple) {
  const cleanups = [];
  const { useCommandCenterShortcut } = load("src/hooks/General/useCommandCenterShortcut.ts", {
    react: { useEffect: (effect) => cleanups.push(effect()) },
    "@/lib/constants/commandCenterShortcut": load("src/lib/constants/commandCenterShortcut.ts"),
    "@/hooks/useFlag": { useFlag: () => true },
    "@/lib/flags/keys": { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "compose" },
    "@/lib/state": { useSetRecoilState: () => (value) => calls.push(["global-palette", value]) },
    "@/store": { showCommandsAtom: "commands" },
    "@/models/enums": { CommandMode: { Command: "command" } },
  });
  const previous = global.document;
  global.document = dom.window.document;
  try {
    useCommandCenterShortcut(985, apple, "/project", false, false, () => calls.push(["toggle"]));
  } finally { global.document = previous; }
  return () => {
    global.document = dom.window.document;
    try { cleanups.forEach((cleanup) => cleanup?.()); }
    finally { global.document = previous; }
  };
}

test("C form Ctrl+J wins over both compose listeners with the flag on, regardless of mount order, and preserves the old palette with it off", async () => {
  for (const width of [1440, 390]) {
    for (const apple of [false, true]) {
      for (const enabled of [false, true]) {
        for (const paletteFirst of [false, true]) {
          const dom = new JSDOM("<div id='createTaskModal'><textarea id='title-input-modal'></textarea><div class='ProseMirror' contenteditable='true' tabindex='0'></div></div>");
          dom.window.innerWidth = width;
          const calls = [];
          const cleanups = [globalComposeListener(calls, dom, apple)];
          const registerPalette = () => cleanups.push(composePaletteListener(enabled, calls, dom, apple));
          const registerHandoff = () => cleanups.push(draftHandoff(enabled, async (...args) => {
            calls.push(["save", ...args]);
            return "/detail/project-6859/43";
          }, calls, dom, apple));
          try {
            if (paletteFirst) { registerPalette(); registerHandoff(); }
            else { registerHandoff(); registerPalette(); }
            for (const selector of ["#title-input-modal", ".ProseMirror"]) {
              const target = dom.window.document.querySelector(selector);
              target.focus();
              assert.equal(dom.window.document.activeElement, target);
              const event = new dom.window.KeyboardEvent("keydown", { key: "j", code: "KeyJ", keyCode: 74, ctrlKey: !apple, metaKey: apple, bubbles: true, cancelable: true });
              assert.equal(target.dispatchEvent(event), false);
              await Promise.resolve();
            }
            if (enabled) {
              assert.deepEqual(calls, [["busy", true], ["save", undefined, "New Task"], ["navigate", "/detail/project-6859/43?newTaskAi=1"], ["close", true], ["busy", false]]);
            } else {
              assert.equal(calls.length, 2);
              for (const [kind, value] of calls) {
                assert.equal(kind, "palette");
                assert.equal(value.show, true);
                assert.equal(value.mode, "command");
                assert.equal(value.paletteTab, "compose");
                assert.deepEqual(value.composeProject, { id: 6859 });
                assert.equal(typeof value.composeOnCreated, "function");
              }
            }
          } finally {
            cleanups.reverse().forEach((cleanup) => cleanup?.());
            dom.window.close();
          }
        }
      }
    }
  }
});
