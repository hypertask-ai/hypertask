import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";

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
    ])
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

const tablePage =
  "<p>Before</p>" +
  "<table><tbody><tr><td>Alpha</td><td>Beta</td></tr><tr><td>Gamma</td><td>Delta</td></tr></tbody></table>" +
  "<p>After</p>";

function createTestEditor(t: test.TestContext, withTables: boolean) {
  const dom = new JSDOM('<div id="editor"></div>');
  const restoreGlobals = installBrowserGlobals(dom.window);
  const editor = new Editor({
    element: dom.window.document.querySelector("#editor"),
    extensions: withTables ? [StarterKit, TableKit] : [StarterKit],
    content: tablePage,
  });
  t.after(() => {
    editor.destroy();
    restoreGlobals();
    dom.window.close();
  });
  return editor;
}

test("without a table node a cell's text runs into the next cell", (t) => {
  const editor = createTestEditor(t, false);
  assert.doesNotMatch(editor.getHTML(), /<table/);
  assert.match(editor.state.doc.textContent, /Alpha\s*Beta/);
});

test("a page's table keeps every cell apart when it is loaded", (t) => {
  const editor = createTestEditor(t, true);
  const html = editor.getHTML();
  assert.match(html, /<table/);
  assert.equal((html.match(/<td/g) ?? []).length, 4);
  for (const cell of ["Alpha", "Beta", "Gamma", "Delta"]) {
    assert.match(html, new RegExp(`<td[^>]*><p>${cell}</p></td>`));
  }
  assert.equal((html.match(/<tr/g) ?? []).length, 2);
});

test("a saved page keeps its table when the editor opens it again", (t) => {
  const editor = createTestEditor(t, true);
  const saved = editor.getHTML();
  editor.commands.setContent(saved);
  const reopened = editor.getHTML();
  assert.equal((reopened.match(/<td/g) ?? []).length, 4);
  assert.match(reopened, /<td[^>]*><p>Gamma<\/p><\/td>/);
});

test("the page editor registers the table kit", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/RTE/Tiptap.ts"),
    "utf8"
  );
  assert.match(source, /import \{ TableKit \} from "@tiptap\/extension-table"/);
  assert.match(source, /\n\s*TableKit\.configure\(/);
});
