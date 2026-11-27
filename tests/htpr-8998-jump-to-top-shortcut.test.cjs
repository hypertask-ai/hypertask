const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG_KEY = "htpr-8998-ticket-jump-to-top";
const NAVIGATION = "src/app/detail/[...slug]/useTaskDetailNavigationActions.tsx";

function loadNavigation(flagOn) {
  const scrolls = [];
  const focus = [];
  const virtualized = [];
  const mod = loadModule(NAVIGATION, {
    "@/hooks/useFlag": { useFlag: (key) => key === FLAG_KEY && flagOn },
    "@/lib/flags/keys": {},
    "@/lib/flags/definitions/htpr-8998-ticket-jump-to-top": { HTPR_8998_TICKET_JUMP_TO_TOP_FLAG: FLAG_KEY },
    "@/lib/taskDetailJumpToTop": { scrollTicketToTop: (target) => scrolls.push(target) },
    "@/lib/taskDetailReads": { refreshTaskDetailReadAfterWrite: () => {} },
    "@/lib/api/typedClient": {},
    "react-hot-toast": { __esModule: true, default: () => {} },
    "@/lib/configs/taskDetail.config": {
      __esModule: true,
      default: { delays: { doubleKeyPress: 500 }, queryKeys: { taskLabels: "labels" } },
    },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
    "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments", gThenKeyDelay: 700 } },
  });
  const element = { scrollTop: 900 };
  const context = {
    lastGPress: { current: null },
    defaultCommentFocus: () => focus.push("comment"),
    focusOn: (id, select) => focus.push([id, select]),
    scrollVirtualize: (where) => virtualized.push(where),
    scrollElementRef: { current: element },
  };
  return { gPressHandler: mod.useTaskDetailNavigationActions(() => context).gPressHandler, scrolls, focus, virtualized, element };
}

const pressG = (handler) => {
  handler({ preventDefault() {} }, false);
  handler({ preventDefault() {} }, false);
};

test("the shortcut help lists G then G for jump to top", () => {
  const { getKeyboardShortcuts } = loadModule("src/lib/constants/shortcuts.ts");
  const rows = getKeyboardShortcuts(true, false, "Toggle history events", true, true);
  const taskView = rows.find((group) => group.title === "Task View");
  assert.deepEqual(taskView.sub.filter((row) => row.shortTitle === "Jump to top"), [
    { shortTitle: "Jump to top", pressKey: ["G", null, "G"] },
  ]);
});

test("G then G jumps the ticket scroller to the top when the flag is on", () => {
  const nav = loadNavigation(true);
  pressG(nav.gPressHandler);
  assert.deepEqual(nav.scrolls, [nav.element]);
  assert.deepEqual(nav.focus, [], "the description keeps its focus");
  assert.deepEqual(nav.virtualized, [], "no jump to the description");
});

test("flag off keeps G then G moving to the description", () => {
  const nav = loadNavigation(false);
  pressG(nav.gPressHandler);
  assert.deepEqual(nav.scrolls, []);
  assert.deepEqual(nav.focus, [["description-container", false]]);
  assert.deepEqual(nav.virtualized, ["description"]);
});

test("Shift then G then G still focuses the new comment with the flag on", () => {
  const nav = loadNavigation(true);
  const event = { preventDefault() {} };
  nav.gPressHandler(event, true);
  nav.gPressHandler(event, true);
  assert.deepEqual(nav.scrolls, []);
  assert.deepEqual(nav.focus, ["comment"]);
});

function withDom(body, run) {
  const dom = new JSDOM(`<body>${body}</body>`, { pretendToBeVisual: true, url: "https://app.hypertask.ai/detail/project-15/8998" });
  const saved = new Map();
  for (const name of ["window", "document", "HTMLElement", "Element"]) {
    saved.set(name, Object.getOwnPropertyDescriptor(global, name));
    global[name] = name === "window" ? dom.window : name === "document" ? dom.window.document : dom.window[name];
  }
  try {
    return run(dom.window);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
}

function loadKeyboard() {
  const pressed = [];
  const { createTaskDetailKeyboard } = loadModule("src/app/detail/[...slug]/taskDetailKeyboard.ts", {
    "./taskDetailNavigationKeymap": { taskDetailNavigationKeymap: () => [] },
    "@/lib/constants": { __esModule: true, default: { gThenKeyDelay: 700 } },
    "@/lib/constants/aiEvents": { AI_SUGGEST_REPLY_EVENT: "ai-suggest-reply" },
    "@/lib/utils/keyboardShortcuts": {
      keyboard_shortcuts: { dueDateModal: { default: {} } },
      matchesShortcut: () => false,
    },
  });
  const keyboard = createTaskDetailKeyboard({
    isApple: false,
    currentTask: { id: 1, projectId: 15, uniqueIndex: 8998, sectionId: 1 },
    editMode: "comment",
    editModeCheck: false,
    controller: {},
    activeModals: [],
    carousalItems: undefined,
    showCommands: { show: false },
    showDropdown: false,
    showMoveModal: false,
    showPriorityModal: false,
    showShortcuts: false,
    showAssignModal: false,
    showCreateLabelModal: false,
    isRecording: false,
    sectionsForProjectTQ: [],
    lastGPress: { current: null },
    lastM_APress: { current: 0 },
    gPressHandler: () => pressed.push("g"),
    resetShowCommands: () => {},
    setShowDropdown: () => {},
    setShowShortcuts: () => {},
    setShowCommentDeleteModal: () => {},
    setShowCreateLabelModal: () => {},
    setIsSummaryExpand: () => {},
    setEditMode: () => {},
    focusOn: () => {},
    defaultCommentFocus: () => {},
    titleEscapeHandler: () => {},
  });
  return { keyboard, pressed };
}

const keydown = (window, keyCode) => {
  const event = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "g" });
  Object.defineProperty(event, "keyCode", { value: keyCode });
  Object.defineProperty(event, "isComposing", { value: false });
  return event;
};

test("G then G does nothing while the cursor is in a text field", () => {
  withDom(`<input id="title-input" /><textarea id="comment-box"></textarea><div id="page-body" tabindex="0"></div>`, (window) => {
    const { keyboard, pressed } = loadKeyboard();
    for (const id of ["title-input", "comment-box"]) {
      const field = window.document.getElementById(id);
      field.focus();
      assert.equal(window.document.activeElement, field);
      const event = keydown(window, 71);
      keyboard.handleKeyDown(event);
      keyboard.handleKeyDown(keydown(window, 71));
      assert.equal(event.defaultPrevented, false, `${id} keeps its G keystroke`);
      assert.deepEqual(pressed, [], `${id} never reaches the jump to top shortcut`);
    }

    window.document.getElementById("page-body").focus();
    keyboard.handleKeyDown(keydown(window, 71));
    keyboard.handleKeyDown(keydown(window, 71));
    assert.deepEqual(pressed, ["g", "g"], "outside a field G then G still runs");
  });
});
