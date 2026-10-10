import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { writingAssistanceEditorProps } from "../src/components/RTE/writingAssistance";
import { LocalWritingAssistance } from "../src/components/RTE/writingAssistance";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const root = path.resolve(import.meta.dirname, "..");

function installBrowserGlobals(window: Window & typeof globalThis) {
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
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(callback, 0),
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
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

test("shared writing assistance attributes reach the editable ProseMirror node", (t) => {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  let editor: Editor | undefined;
  t.after(() => {
    editor?.destroy();
    restoreGlobals();
    dom.window.close();
  });

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
  assert.match(sharedEditor, /LocalWritingAssistance\.configure/);
  assert.match(aiChatEditor, /LocalWritingAssistance\.configure/);
});

function dispatchTextInput(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  return Boolean(
    editor.view.someProp("handleTextInput", (handler) =>
      handler(
        editor.view,
        from,
        to,
        text,
        () => editor.state.tr.insertText(text, from, to),
      ),
    ),
  );
}

test("local writing assistance capitalizes typed sentence starts and remains undoable", (t) => {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  const editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: [
      StarterKit,
      LocalWritingAssistance.configure({
        localCapitalizationEnabled: () => true,
      }),
    ],
    content: "<p>hello.</p>",
    editorProps: writingAssistanceEditorProps,
  });
  t.after(() => {
    editor.destroy();
    restoreGlobals();
    dom.window.close();
  });

  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(" ");
  editor.view.dispatch(closeHistory(editor.state.tr));
  assert.equal(dispatchTextInput(editor, "w"), true);
  assert.equal(editor.getText(), "hello. W");
  assert.equal(editor.commands.undo(), true);
  assert.equal(editor.getText(), "hello. ");

  editor.commands.setContent("<p>hello. “</p>", { emitUpdate: false });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  assert.equal(dispatchTextInput(editor, "w"), true);
  assert.equal(editor.getText(), "hello. “W");

  editor.commands.setContent("<p>He said “stop.”</p>", { emitUpdate: false });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(" ");
  assert.equal(dispatchTextInput(editor, "w"), true);
  assert.equal(editor.getText(), "He said “stop.” W");

  editor.commands.setContent("<p>Try e.g.</p>", { emitUpdate: false });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(" ");
  assert.equal(dispatchTextInput(editor, "w"), false);
});

test("local writing assistance respects its flag and skips prose mid-sentence", (t) => {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  let enabled = false;
  const editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: [
      StarterKit,
      LocalWritingAssistance.configure({
        localCapitalizationEnabled: () => enabled,
      }),
    ],
    content: "<p>hello </p>",
    editorProps: writingAssistanceEditorProps,
  });
  t.after(() => {
    editor.destroy();
    restoreGlobals();
    dom.window.close();
  });

  editor.commands.setTextSelection(1);
  assert.equal(dispatchTextInput(editor, "w"), false);
  enabled = true;

  editor.commands.setContent("<p></p>", { emitUpdate: false });
  assert.equal(dispatchTextInput(editor, "w"), true);
  assert.equal(editor.getText(), "W");

  editor.commands.setContent("<p>hello </p>", { emitUpdate: false });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  assert.equal(dispatchTextInput(editor, "w"), false);
});

test("local writing assistance skips code blocks and unfinished keyboard input", (t) => {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  const editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: [
      StarterKit,
      LocalWritingAssistance.configure({
        localCapitalizationEnabled: () => true,
      }),
    ],
    content: "<pre><code></code></pre>",
    editorProps: writingAssistanceEditorProps,
  });
  t.after(() => {
    editor.destroy();
    restoreGlobals();
    dom.window.close();
  });

  editor.commands.setTextSelection(1);
  assert.equal(dispatchTextInput(editor, "w"), false);

  editor.commands.setContent("<p></p>", { emitUpdate: false });
  Object.defineProperty(editor.view, "composing", {
    configurable: true,
    value: true,
  });
  assert.equal(dispatchTextInput(editor, "w"), false);
});

function makeUndoEditor(
  t: { after: (fn: () => void) => void },
  options: { undo: boolean },
) {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  const editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: [
      StarterKit,
      LocalWritingAssistance.configure({
        localCapitalizationEnabled: () => true,
        undoCapitalizationEnabled: () => options.undo,
      }),
    ],
    content: "<p>hello.</p>",
    editorProps: writingAssistanceEditorProps,
  });
  t.after(() => {
    editor.destroy();
    restoreGlobals();
    dom.window.close();
  });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(" ");
  return editor;
}

function pressKey(editor: Editor, init: KeyboardEventInit) {
  const event = new editor.view.dom.ownerDocument.defaultView!.KeyboardEvent("keydown", init);
  return Boolean(
    editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event)),
  );
}

function underlined(editor: Editor) {
  return editor.view.dom.querySelectorAll("span[style*='underline']").length;
}

test("HTPR-6906: Backspace right after an auto-capital restores lowercase and it stays lowercase", (t) => {
  const editor = makeUndoEditor(t, { undo: true });
  assert.equal(dispatchTextInput(editor, "w"), true);
  assert.equal(editor.getText(), "hello. W");
  assert.equal(underlined(editor), 1);
  assert.equal(pressKey(editor, { key: "Backspace" }), true);
  assert.equal(editor.getText(), "hello. w");
  assert.equal(underlined(editor), 0);
  // Typing on keeps the lowercase letter and nothing re-capitalizes it.
  assert.equal(dispatchTextInput(editor, "o"), false);
  editor.commands.insertContent("o");
  assert.equal(editor.getText(), "hello. wo");
  // Backspace now deletes normally.
  assert.equal(pressKey(editor, { key: "Backspace" }), false);
});

for (const [name, init] of [
  ["Ctrl+Z", { ctrlKey: true }],
  ["Cmd+Z", { metaKey: true }],
] as const) {
  test(`HTPR-6906: ${name} right after an auto-capital restores lowercase`, (t) => {
    const editor = makeUndoEditor(t, { undo: true });
    dispatchTextInput(editor, "w");
    assert.equal(pressKey(editor, { key: "z", ...init }), true);
    assert.equal(editor.getText(), "hello. w");
  });
}

test("HTPR-6906: Backspace after more was typed behaves normally", (t) => {
  const editor = makeUndoEditor(t, { undo: true });
  dispatchTextInput(editor, "w");
  editor.commands.insertContent("x");
  assert.equal(pressKey(editor, { key: "Backspace" }), false);
  assert.equal(editor.getText(), "hello. Wx");
});

test("HTPR-6906: Backspace after the cursor moved away and back behaves normally", (t) => {
  const editor = makeUndoEditor(t, { undo: true });
  dispatchTextInput(editor, "w");
  editor.commands.setTextSelection(2);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  assert.equal(pressKey(editor, { key: "Backspace" }), false);
  assert.equal(editor.getText(), "hello. W");
});

test("HTPR-6906: the underline clears on its own after a moment but undo still works", async (t) => {
  const editor = makeUndoEditor(t, { undo: true });
  dispatchTextInput(editor, "w");
  assert.equal(underlined(editor), 1);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal(underlined(editor), 0);
  assert.equal(pressKey(editor, { key: "Backspace" }), true);
  assert.equal(editor.getText(), "hello. w");
});

test("HTPR-6906: with the undo flag off nothing changes", (t) => {
  const editor = makeUndoEditor(t, { undo: false });
  assert.equal(dispatchTextInput(editor, "w"), true);
  assert.equal(editor.getText(), "hello. W");
  assert.equal(underlined(editor), 0);
  assert.equal(pressKey(editor, { key: "Backspace" }), false);
  // Ctrl+Z is plain history undo again: it removes the letter, no lowercase restore.
  pressKey(editor, { key: "z", ctrlKey: true });
  assert.equal(editor.getText(), "hello.");
});
