import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { writingAssistanceEditorProps } from "../src/components/RTE/writingAssistance";

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
});
