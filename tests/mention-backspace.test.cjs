const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const tiptapSource = fs.readFileSync(
  path.join(root, "src/components/RTE/Tiptap.ts"),
  "utf8",
);

function sharedEditorRegistersMentionDeletion(source) {
  const sourceFile = ts.createSourceFile(
    "Tiptap.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let registered = false;

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "withMentionBackspaceDeletion" &&
      ts.isSpreadElement(node.parent) &&
      ts.isArrayLiteralExpression(node.parent.parent) &&
      ts.isArrowFunction(node.parent.parent.parent) &&
      ts.isCallExpression(node.parent.parent.parent.parent) &&
      ts.isIdentifier(node.parent.parent.parent.parent.expression) &&
      node.parent.parent.parent.parent.expression.text === "useMemo"
    ) {
      registered = true;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return registered;
}

function loadTypescriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module_ = { exports: {} };
  new Function("require", "module", "exports", javascript)(
    require,
    module_,
    module_.exports,
  );
  return module_.exports;
}

const browserGlobals = (window) => ({
  window,
  document: window.document,
  Node: window.Node,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  MutationObserver: window.MutationObserver,
  DOMParser: window.DOMParser,
  KeyboardEvent: window.KeyboardEvent,
  InputEvent: window.InputEvent,
  navigator: window.navigator,
  getSelection: window.getSelection.bind(window),
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
});

function installBrowserGlobals(window) {
  const globals = browserGlobals(window);
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

function mentionPosition(editor) {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "mention") {
      position = pos;
      return false;
    }
  });
  assert.notEqual(position, -1, "mention node was not parsed");
  return position;
}

function backwardDelete(window, options = {}) {
  const event = new window.InputEvent("beforeinput", {
    bubbles: true,
    cancelable: options.cancelable ?? true,
    inputType: options.inputType ?? "deleteContentBackward",
  });
  if (options.isComposing) {
    Object.defineProperty(event, "isComposing", { value: true });
  }
  return event;
}

test("the shared editor extension array registers mention deletion", () => {
  assert.equal(sharedEditorRegistersMentionDeletion(tiptapSource), true);
});

test("Android-style backward input deletes only the mention before the caret", async () => {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  const { Editor } = require("@tiptap/core");
  const StarterKit = require("@tiptap/starter-kit").default;
  const Mention = require("@tiptap/extension-mention").default;
  const { withMentionBackspaceDeletion } = loadTypescriptModule(
    path.join(
      root,
      "src/components/RTE/Extensions/DeleteMentionOnBackspace.ts",
    ),
  );

  const editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: [StarterKit, ...withMentionBackspaceDeletion(Mention)],
    content:
      '<p>before <span data-type="mention" data-id="Ada" data-label="name-7">Ada</span> after</p>',
  });

  try {
    const position = mentionPosition(editor);
    editor.commands.setTextSelection(position + 1);
    let transactionCount = 0;
    editor.on("transaction", () => {
      transactionCount += 1;
    });

    const event = backwardDelete(dom.window, { isComposing: true });
    editor.view.dom.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 75));

    assert.equal(event.defaultPrevented, true);
    assert.equal(transactionCount, 1);
    assert.equal(editor.getText(), "before  after");
    assert.doesNotMatch(editor.getHTML(), /data-type="mention"/);

    editor.commands.setContent(
      '<p>before <span data-type="mention" data-id="Ada" data-label="name-7">Ada</span> after</p>',
    );
    const hardwarePosition = mentionPosition(editor);
    editor.commands.setTextSelection(hardwarePosition + 1);
    const handled = editor.view.someProp("handleKeyDown", (handler) =>
      handler(
        editor.view,
        new dom.window.KeyboardEvent("keydown", { key: "Backspace" }),
      ),
    );
    assert.equal(handled, true);
    assert.equal(editor.getText(), "before  after");
    assert.doesNotMatch(editor.getHTML(), /data-type="mention"/);
  } finally {
    editor.destroy();
    restoreGlobals();
    dom.window.close();
  }
});

test("mention deletion ignores text, selections, read-only editors, and other input", () => {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  const { Editor } = require("@tiptap/core");
  const StarterKit = require("@tiptap/starter-kit").default;
  const Mention = require("@tiptap/extension-mention").default;
  const { withMentionBackspaceDeletion } = loadTypescriptModule(
    path.join(
      root,
      "src/components/RTE/Extensions/DeleteMentionOnBackspace.ts",
    ),
  );
  const editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: [StarterKit, ...withMentionBackspaceDeletion(Mention)],
    content:
      '<p>text <span data-type="mention" data-id="Ada" data-label="name-7">Ada</span></p>',
  });

  try {
    const initialHtml = editor.getHTML();
    const position = mentionPosition(editor);

    editor.commands.setTextSelection(3);
    const textEvent = backwardDelete(dom.window);
    editor.view.dom.dispatchEvent(textEvent);
    assert.equal(textEvent.defaultPrevented, false);

    editor.commands.setTextSelection({ from: position, to: position + 1 });
    const selectionEvent = backwardDelete(dom.window);
    editor.view.dom.dispatchEvent(selectionEvent);
    assert.equal(selectionEvent.defaultPrevented, false);

    editor.commands.setTextSelection(position + 1);
    const insertEvent = backwardDelete(dom.window, { inputType: "insertText" });
    editor.view.dom.dispatchEvent(insertEvent);
    assert.equal(insertEvent.defaultPrevented, false);

    const nonCancelableEvent = backwardDelete(dom.window, { cancelable: false });
    editor.view.dom.dispatchEvent(nonCancelableEvent);
    assert.equal(nonCancelableEvent.defaultPrevented, false);

    editor.setEditable(false);
    const readOnlyEvent = backwardDelete(dom.window);
    editor.view.dom.dispatchEvent(readOnlyEvent);
    assert.equal(readOnlyEvent.defaultPrevented, false);

    assert.equal(editor.getHTML(), initialHtml);
  } finally {
    editor.destroy();
    restoreGlobals();
    dom.window.close();
  }
});
