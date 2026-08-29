const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// jsdom 30's undici dependency uses this Node 22 API. Keep the DOM regression
// runnable on the current CI runner's older Node without changing CI itself.
const workerThreads = require("node:worker_threads");
if (typeof workerThreads.markAsUncloneable !== "function") {
  workerThreads.markAsUncloneable = () => {};
}
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(
  path.join(__dirname, "../src/lib/demo/guestDescriptionEdit.ts"),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const module_ = { exports: {} };
new Function("module", "exports", javascript)(module_, module_.exports);
const {
  dispatchGuestDescriptionEditRequest,
  GUEST_DESCRIPTION_EDITOR_ID,
  GUEST_DESCRIPTION_INTERACTIVE_TARGET,
  shouldEnterGuestDescriptionEdit,
  subscribeGuestDescriptionEditRequests,
  syncGuestDescriptionEditorState,
} = module_.exports;

const click = (overrides = {}) =>
  shouldEnterGuestDescriptionEdit({
    isGuest: true,
    isMobile: false,
    clickCount: 1,
    isEditorSurface: true,
    isInteractiveTarget: false,
    ...overrides,
  });

test("a demo guest enters description edit mode on the first desktop click", () => {
  assert.equal(click(), true);
});

test("signed-up users retain the deliberate double-click interaction", () => {
  assert.equal(click({ isGuest: false }), false);
});

test("links, media, and controls remain usable in the guest read view", () => {
  assert.equal(click({ isInteractiveTarget: true }), false);
  for (const target of [
    "a",
    "button",
    "img",
    "video",
    "audio",
    "iframe",
    "[data-node-view-wrapper]",
  ]) {
    assert.match(
      GUEST_DESCRIPTION_INTERACTIVE_TARGET,
      new RegExp(target.replaceAll("[", "\\[").replaceAll("]", "\\]")),
    );
  }
});

test("clicks elsewhere in the description card do not enter edit mode", () => {
  assert.equal(click({ isEditorSurface: false }), false);
});

test("the second click of a double click does not schedule another edit", () => {
  assert.equal(click({ clickCount: 2 }), false);
});

test("mobile keeps its existing double-tap interaction", () => {
  assert.equal(click({ isMobile: true }), false);
});

test("the guest component path requests editing synchronously without changing established paths", () => {
  const component = fs.readFileSync(
    path.join(
      __dirname,
      "../src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/index.tsx",
    ),
    "utf8",
  );
  assert.match(component, /target\.closest\("#description-input"\)/);

  const guestHandler = component.slice(
    component.indexOf("const editGuestDescriptionHandler"),
    component.indexOf("const handleDoubleTap"),
  );
  assert.doesNotMatch(guestHandler, /setTimeout/);
  assert.ok(
    guestHandler.indexOf("dispatchGuestDescriptionEditRequest") <
      guestHandler.indexOf("enterDescriptionEditMode();"),
    "the mounted editor must receive its one-shot request before the sync state update",
  );

  const establishedHandler = component.slice(
    component.indexOf("const editDescriptionHandler"),
    component.indexOf("const editGuestDescriptionHandler"),
  );
  assert.match(establishedHandler, /setTimeout\(enterDescriptionEditMode, 100\)/);

  const doubleClickHandler = component.slice(
    component.indexOf("const handleDesktopDoubleClick"),
    component.indexOf("const selectDescription"),
  );
  assert.match(doubleClickHandler, /if \(isGuest\) return;/);

  const tiptap = fs.readFileSync(
    path.join(__dirname, "../src/components/RTE/TipTapTaskDetail.tsx"),
    "utf8",
  );
  assert.match(
    tiptap,
    /pendingGuestDescriptionFocusTaskRef = useRef<number \| null>\(null\)/,
  );
  assert.match(
    tiptap,
    /useLayoutEffect\(\(\) => \{[\s\S]*?pendingGuestDescriptionFocusTaskRef\.current !== currentTask\.id[\s\S]*?syncGuestDescriptionEditorState/,
    "the matching component-local request must become editable before paint",
  );
  assert.doesNotMatch(tiptap, /querySelector<HTMLElement>\("#description-input"\)/);
});

function createEditorHarness(document) {
  const proseMirror = document.querySelector(".ProseMirror");
  let focused = false;

  proseMirror.addEventListener("beforeinput", (event) => {
    if (document.activeElement === proseMirror && event.data) {
      proseMirror.textContent += event.data;
    }
  });

  return {
    proseMirror,
    editor: {
      get isFocused() {
        return focused;
      },
      setEditable(editable, emitUpdate) {
        assert.equal(emitUpdate, false);
        proseMirror.setAttribute("contenteditable", String(editable));
      },
      commands: {
        focus(position) {
          assert.equal(position, "end");
          proseMirror.focus();
          focused = document.activeElement === proseMirror;
          return focused;
        },
      },
    },
  };
}

test("one guest click synchronously requests editing, then the committed editor accepts immediate input", () => {
  const dom = new JSDOM(
    `<div id="description-input"><div class="ProseMirror" contenteditable="false" tabindex="0"></div></div>`,
  );
  const { document, InputEvent } = dom.window;
  const { editor, proseMirror } = createEditorHarness(document);
  const taskId = 101;
  let pendingTaskId = null;
  let editRequested = false;

  const unsubscribe = subscribeGuestDescriptionEditRequests({
    root: dom.window,
    taskId,
    editorId: GUEST_DESCRIPTION_EDITOR_ID,
    onRequest: (requestedTaskId) => {
      pendingTaskId = requestedTaskId;
      editRequested = true;
    },
    onClear: () => {
      pendingTaskId = null;
    },
  });

  dispatchGuestDescriptionEditRequest(dom.window, {
    taskId,
    editorId: GUEST_DESCRIPTION_EDITOR_ID,
  });
  assert.equal(editRequested, true, "the request must complete in the click turn");
  assert.equal(pendingTaskId, taskId);

  assert.equal(
    syncGuestDescriptionEditorState({
      editor,
      editable: true,
      isGuest: true,
      isMobile: false,
      mode: "read-edit-description",
      taskId,
      pendingTaskId,
      clearPending: () => {
        pendingTaskId = null;
      },
    }),
    true,
  );
  assert.equal(proseMirror.getAttribute("contenteditable"), "true");
  assert.equal(document.activeElement, proseMirror);
  assert.equal(pendingTaskId, null);

  proseMirror.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
      inputType: "insertText",
    }),
  );
  assert.equal(proseMirror.textContent, "x");
  unsubscribe();
});

test("task/editor mismatches cannot arm or focus this description editor", () => {
  const dom = new JSDOM(
    `<div class="ProseMirror" contenteditable="false" tabindex="0"></div>`,
  );
  const { document } = dom.window;
  const { editor, proseMirror } = createEditorHarness(document);
  let pendingTaskId = null;
  let cleared = false;

  const unsubscribe = subscribeGuestDescriptionEditRequests({
    root: dom.window,
    taskId: 101,
    editorId: GUEST_DESCRIPTION_EDITOR_ID,
    onRequest: (taskId) => {
      pendingTaskId = taskId;
    },
    onClear: () => {
      pendingTaskId = null;
    },
  });

  dispatchGuestDescriptionEditRequest(dom.window, {
    taskId: 202,
    editorId: GUEST_DESCRIPTION_EDITOR_ID,
  });
  dispatchGuestDescriptionEditRequest(dom.window, {
    taskId: 101,
    editorId: "comment-9",
  });
  assert.equal(pendingTaskId, null);
  assert.equal(
    syncGuestDescriptionEditorState({
      editor,
      editable: true,
      isGuest: true,
      isMobile: false,
      mode: "read-edit-description",
      taskId: 101,
      pendingTaskId: 202,
      clearPending: () => {
        cleared = true;
      },
    }),
    false,
  );
  assert.equal(cleared, false);
  assert.notEqual(document.activeElement, proseMirror);
  unsubscribe();
});

test("navigation cleanup clears the local request and removes the old task listener", () => {
  const dom = new JSDOM(`<div></div>`);
  let pendingTaskId = null;
  const unsubscribe = subscribeGuestDescriptionEditRequests({
    root: dom.window,
    taskId: 101,
    editorId: GUEST_DESCRIPTION_EDITOR_ID,
    onRequest: (taskId) => {
      pendingTaskId = taskId;
    },
    onClear: () => {
      pendingTaskId = null;
    },
  });

  dispatchGuestDescriptionEditRequest(dom.window, {
    taskId: 101,
    editorId: GUEST_DESCRIPTION_EDITOR_ID,
  });
  assert.equal(pendingTaskId, 101);
  unsubscribe();
  assert.equal(pendingTaskId, null);

  dispatchGuestDescriptionEditRequest(dom.window, {
    taskId: 101,
    editorId: GUEST_DESCRIPTION_EDITOR_ID,
  });
  assert.equal(pendingTaskId, null);
});
