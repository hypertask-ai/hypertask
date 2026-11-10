const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const keydown = (window, init) => {
  const event = new window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "keyCode", { value: init.keyCode });
  Object.defineProperty(event, "isComposing", { value: init.isComposing === true });
  return event;
};

function withDom(body, run) {
  const dom = new JSDOM(`<body>${body}</body>`, { pretendToBeVisual: true, url: "https://app.hypertask.ai/detail/project-15/8867" });
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
  }
}

function keyboard({ isApple = false } = {}) {
  const { createTaskDetailKeyboard } = loadModule("src/app/detail/[...slug]/taskDetailKeyboard.ts", {
    "./taskDetailNavigationKeymap": { taskDetailNavigationKeymap: () => [] },
    "@/lib/constants": { default: { gThenKeyDelay: 700 } },
    "@/lib/constants/aiEvents": { AI_SUGGEST_REPLY_EVENT: "ai-suggest-reply" },
    "@/lib/utils/keyboardShortcuts": {
      keyboard_shortcuts: { dueDateModal: { default: {} } },
      matchesShortcut: () => false,
    },
  });
  const calls = [];
  const context = {
    isApple,
    currentTask: { id: 1, projectId: 15, uniqueIndex: 8867, sectionId: 1 },
    editMode: "comment",
    editModeCheck: false,
    controller: {},
    activeModals: ["comment-input"],
    classNamesToReturnFrom: [],
    carousalItems: undefined,
    showCommands: { show: false },
    showComments: false,
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
    resetShowCommands: () => calls.push(["resetShowCommands"]),
    setShowDropdown: (value) => calls.push(["setShowDropdown", value]),
    setShowShortcuts: (value) => calls.push(["setShowShortcuts", value]),
    setEditMode: (value) => calls.push(["setEditMode", value]),
    focusOn: (id) => {
      calls.push(["focusOn", id]);
      document.getElementById(id)?.focus();
    },
    defaultCommentFocus: () => calls.push(["defaultCommentFocus"]),
  };
  const instance = createTaskDetailKeyboard(context);
  return { instance, calls };
}

const COMMENT_BOX = `<div id="comment-input" class="ProseMirror" contenteditable="true" tabindex="0"></div>`;
const CHAT = `<div class="chatwindow bg-ai-chat"><div id="ai-chat-tiptap-editor"><div class="ProseMirror" contenteditable="true" tabindex="0"></div></div></div>`;

test("Control+M from the AI chat box moves focus to the comment box", () => {
  withDom(`${COMMENT_BOX}${CHAT}`, (window) => {
    const chatInput = window.document.querySelector(".chatwindow .ProseMirror");
    chatInput.focus();
    assert.equal(window.document.activeElement, chatInput, "chat box owns focus before the shortcut");
    const { instance, calls } = keyboard();
    const event = keydown(window, { key: "m", keyCode: 77, ctrlKey: true });
    instance.handleKeyDown(event);
    assert.equal(event.defaultPrevented, true, "the chat keystroke must not reach the browser default");
    assert.deepEqual(calls, [["setEditMode", "comment"], ["focusOn", "comment-input"]]);
    assert.equal(window.document.activeElement.id, "comment-input");
  });
});

test("the same Control+M outside the chat box still opens comments", () => {
  withDom(`${COMMENT_BOX}${CHAT}<div id="task-1" tabindex="0"></div>`, (window) => {
    window.document.getElementById("task-1").focus();
    const { instance, calls } = keyboard();
    const event = keydown(window, { key: "m", keyCode: 77, ctrlKey: true });
    instance.handleKeyDown(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(calls.filter(([name]) => name === "focusOn"), [["focusOn", "comment-input"]]);
    assert.equal(window.document.activeElement.id, "comment-input");
  });
});

test("Control+Shift+M in the chat box is not the comment shortcut", () => {
  withDom(`${COMMENT_BOX}${CHAT}`, (window) => {
    window.document.querySelector(".chatwindow .ProseMirror").focus();
    const { instance, calls } = keyboard();
    const event = keydown(window, { key: "M", keyCode: 77, ctrlKey: true, shiftKey: true });
    instance.handleKeyDown(event);
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(calls, []);
    assert.equal(window.document.activeElement.className, "ProseMirror");
  });
});

test("Control+M in the chat box with an open modal stays put", () => {
  withDom(`${COMMENT_BOX}${CHAT}<div class="modal"></div>`, (window) => {
    window.document.querySelector(".chatwindow .ProseMirror").focus();
    const { instance, calls } = keyboard();
    const event = keydown(window, { key: "m", keyCode: 77, ctrlKey: true });
    instance.handleKeyDown(event);
    assert.deepEqual(calls, []);
    assert.equal(event.defaultPrevented, false);
  });
});

test("Command+M on a Mac moves focus to the comment box from the chat box", () => {
  withDom(`${COMMENT_BOX}${CHAT}`, (window) => {
    window.document.querySelector(".chatwindow .ProseMirror").focus();
    const { instance } = keyboard({ isApple: true });
    const event = keydown(window, { key: "m", keyCode: 77, metaKey: true });
    instance.handleKeyDown(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(window.document.activeElement.id, "comment-input");
  });
});
