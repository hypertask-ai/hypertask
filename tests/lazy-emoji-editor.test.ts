import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import LazyEmoji from "../src/components/RTE/Extensions/LazyEmoji";
import {
  ensureEmojiData,
  getEmojiItems,
} from "../src/components/RTE/Extensions/lazyEmojiData";

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

test("stored emoji HTML round-trips unchanged with zero dataset loaded", (t) => {
  assert.equal(getEmojiItems().length, 0);
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
    extensions: [StarterKit, LazyEmoji],
    content: '<p>Hi <span data-type="emoji" data-name="grinning">😀</span></p>',
  });

  const html = editor.getHTML();
  assert.match(html, /<span [^>]*data-name="grinning"/);
  assert.match(html, /data-type="emoji"/);
  assert.ok(html.includes("😀"), html);
  assert.ok(!html.includes(":grinning:"), html);
  assert.equal(editor.getText(), "Hi 😀");
});

test("emoticon typing stays plain text while the dataset is not loaded", (t) => {
  assert.equal(getEmojiItems().length, 0);
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
    extensions: [StarterKit, LazyEmoji.configure({ enableEmoticons: true })],
    content: "<p></p>",
  });

  editor.commands.insertContent(":D");
  editor.view.someProp("handleTextInput", (f: any) =>
    f(editor!.view, 3, 3, " "),
  );

  const json = JSON.stringify(editor.getJSON());
  assert.ok(json.includes('":D"'), json);
  assert.ok(!json.includes('"type":"emoji"'), json);
});

test("ensureEmojiData is single-flight", () => {
  const first = ensureEmojiData();
  const second = ensureEmojiData();
  assert.equal(first, second);
  return first;
});

test("dataset install activates lookup, storage, and the emoticon rule", async (t) => {
  await ensureEmojiData();
  assert.ok(getEmojiItems().length > 0);

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
    extensions: [
      StarterKit,
      LazyEmoji.configure({ enableEmoticons: true }),
    ],
    content:
      '<p><span data-type="emoji" data-name="grinning">:grinning:</span></p>',
  });

  assert.ok((editor.storage.emoji as { emojis: unknown[] }).emojis.length > 0);
  const html = editor.getHTML();
  assert.match(html, /data-name="grinning"/);
  assert.ok(!html.includes(":grinning:"), html);

  const emoticonItem = getEmojiItems().find(
    (item) => (item.emoticons ?? []).length > 0,
  );
  assert.ok(emoticonItem);
  editor.commands.clearContent();
  editor.commands.insertContent(emoticonItem.emoticons![0]);
  const end = editor.state.selection.to;
  editor.view.someProp("handleTextInput", (f: any) => f(editor!.view, end, end, " "));
  const found = (() => {
    let match: { name: string } | null = null;
    editor!.state.doc.descendants((node) => {
      if (node.type.name === "emoji") {
        match = { name: node.attrs.name };
        return false;
      }
      return true;
    });
    return match;
  })();
  assert.ok(found, "emoticon should convert to an emoji node");
  assert.equal((found as { name: string }).name, emoticonItem.name);
});

test("the retired lazy emoji list flag never ships again", () => {
  const { modes } = JSON.parse(
    fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"),
  );
  assert.equal(Object.hasOwn(modes, "htpr-6059-lazy-emoji-list"), false);
});
