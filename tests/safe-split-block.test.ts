import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SafeSplitBlock } from "../src/components/RTE/Extensions/SafeSplitBlock";

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
    KeyboardEvent: window.KeyboardEvent,
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

function createTestEditor(t: test.TestContext, content: string) {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  const editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: [StarterKit, SafeSplitBlock],
    content,
  });
  t.after(() => {
    editor.destroy();
    restoreGlobals();
    dom.window.close();
  });
  return { dom, editor };
}

test("splitBlock rejects a cross-block selection without throwing", (t) => {
  const { editor } = createTestEditor(t, "<p>one</p><p>two</p>");
  const before = editor.getHTML();
  editor.commands.setTextSelection({ from: 1, to: 6 });

  assert.equal(editor.can().splitBlock(), false);
  assert.equal(editor.commands.splitBlock(), false);
  assert.equal(editor.getHTML(), before);
});

test("Enter on a cross-block selection does not throw", (t) => {
  const { dom, editor } = createTestEditor(t, "<p>one</p><p>two</p>");
  const before = editor.getHTML();
  editor.commands.setTextSelection({ from: 1, to: 6 });

  assert.doesNotThrow(() => {
    editor.view.someProp("handleKeyDown", (handler) =>
      handler(
        editor.view,
        new dom.window.KeyboardEvent("keydown", { key: "Enter" }),
      ),
    );
  });
  assert.equal(editor.getHTML(), before);
});

test("splitBlock safely rejects a selection across list items", (t) => {
  const { editor } = createTestEditor(
    t,
    "<ul><li><p>one</p></li><li><p>two</p></li></ul>",
  );
  editor.commands.setTextSelection({ from: 3, to: 10 });
  const before = editor.getHTML();

  assert.equal(editor.commands.splitBlock(), false);
  assert.equal(editor.getHTML(), before);
});

test("splitBlock keeps ordinary cursor Enter behavior", (t) => {
  const { editor } = createTestEditor(t, "<p>one</p>");
  editor.commands.setTextSelection(2);

  assert.equal(editor.commands.splitBlock(), true);
  assert.equal(editor.state.doc.childCount, 2);
  assert.equal(editor.state.doc.child(0).textContent, "o");
  assert.equal(editor.state.doc.child(1).textContent, "ne");
});

test("every StarterKit editor installs the safe command override", () => {
  for (const relativePath of [
    "src/components/RTE/Tiptap.ts",
    "src/hooks/MultiPages/AIChat/useAiTiptap.ts",
    "src/lib/controlledComposerEditor.tsx",
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(source, /import \{ SafeSplitBlock \} from/);
    assert.match(source, /\n\s*SafeSplitBlock,/);
  }
});
