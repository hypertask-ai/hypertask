const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

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

function installBrowserGlobals(window) {
  const globals = {
    window,
    document: window.document,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    MutationObserver: window.MutationObserver,
    DOMParser: window.DOMParser,
    navigator: window.navigator,
    getSelection: window.getSelection.bind(window),
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
  };
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

test("shared writing assistance attributes reach the editable ProseMirror node", (t) => {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  let editor;
  t.after(() => {
    editor?.destroy();
    restoreGlobals();
    dom.window.close();
  });

  const { Editor } = require("@tiptap/core");
  const StarterKit = require("@tiptap/starter-kit").default;
  const { writingAssistanceEditorProps } = loadTypescriptModule(
    path.join(root, "src/components/RTE/writingAssistance.ts"),
  );

  editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: [StarterKit],
    content: "<p>Text</p>",
    editorProps: writingAssistanceEditorProps,
  });

  assert.equal(editor.view.dom.getAttribute("spellcheck"), "true");
  assert.equal(editor.view.dom.getAttribute("autocorrect"), "on");
  assert.equal(editor.view.dom.getAttribute("autocapitalize"), "sentences");
  assert.equal(editor.view.dom.getAttribute("writingsuggestions"), "true");
});

test("both editor configurations retain the shared writing assistance props", () => {
  const sharedEditor = fs.readFileSync(
    path.join(root, "src/components/RTE/Tiptap.ts"),
    "utf8",
  );
  const aiChatEditor = fs.readFileSync(
    path.join(root, "src/hooks/MultiPages/AIChat/useAiTiptap.ts"),
    "utf8",
  );

  assert.match(sharedEditor, /\.\.\.writingAssistanceEditorProps/);
  assert.match(sharedEditor, /scrollThreshold/);
  assert.match(sharedEditor, /scrollMargin/);
  assert.match(aiChatEditor, /editorProps:\s*writingAssistanceEditorProps/);
});
