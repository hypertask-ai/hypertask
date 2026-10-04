const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { Editor, NodeView } = require("@tiptap/core");
const { StarterKit } = require("@tiptap/starter-kit");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });
const source = "https://files.hypertask.app/picture.png";
const imagePosition = 1 + "Saved text".length;

function load(relativePath, mocks = {}) {
  const target = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", compiled)(
    (specifier) => specifier in mocks ? mocks[specifier] : require(specifier), target, target.exports,
  );
  return target.exports;
}

const normalize = jiti(path.join(root, "src/utils/helperFunctions/normalizeImageSource.ts"));
const { ResizableMediaNodeView } = load("src/components/RTE/Extensions/resizableMedia/ResizableMediaNodeView.tsx", {
  "@tiptap/react": { NodeViewWrapper: ({ as, children, ...props }) => React.createElement(as, props, children) },
  "./styles.scss": {},
  "./resizableMediaMenuUtil": { resizableMediaActions: [] },
  "@/utils/helperFunctions/normalizeImageSource": normalize,
  "@/utils/helperFunctions/getFileTypeFromUrl": jiti(path.join(root, "src/utils/helperFunctions/getFileTypeFromUrl.ts")),
  "@/lib/media/browserRenderableImage": jiti(path.join(root, "src/lib/media/browserRenderableImage.ts")),
});
const { ResizableMedia } = load("src/components/RTE/Extensions/resizableMedia/resizableMedia.ts", {
  "./ResizableMediaNodeView": { ResizableMediaNodeView },
  "./mediaPasteDropPlugin": { getMediaPasteDropPlugin: () => { throw new Error("No upload plugin needed in an unmounted editor"); } },
  "@/utils/helperFunctions/normalizeImageSource": normalize,
});
const { renderPageContent } = load("src/utils/controllers/pages/pageService.ts", {
  "@/lib/prisma": { default: {} },
  "@/utils/controllers/tasks/assertTaskAccess": require("./task-route-loader.cjs").load(
    "src/utils/controllers/tasks/assertTaskAccess.ts", { "@/lib/prisma": { default: {} } },
  ),
  "@/utils/controllers/turbopuffer/turbopufferHelper": { convertToPlain: (html) => require("node-html-parser").parse(html).text },
  "@/utils/helperFunctions/markdownToHtml": {},
  "@/utils/helperFunctions/sanitizeRichHtml": jiti(path.join(root, "src/utils/helperFunctions/sanitizeRichHtml.ts")),
  "./htmlCanvas": {},
});

async function withMedia(context, html, run) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const dom = new JSDOM('<div class="ProseMirror"><div id="root"></div></div>');
  const names = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) Object.defineProperty(global, name, {
    configurable: true, writable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
  });
  Object.defineProperty(document.querySelector(".ProseMirror"), "clientWidth", { value: 800 });
  const editor = new Editor({ element: null, extensions: [StarterKit, ResizableMedia], content: html });
  const reactRoot = createRoot(document.getElementById("root"));
  const updates = [];
  const render = () => reactRoot.render(React.createElement(ResizableMediaNodeView, {
    node: editor.state.doc.nodeAt(imagePosition), editor, deleteNode: () => {},
    updateAttributes: (attrs) => NodeView.prototype.updateAttributes.call({
      editor, node: editor.state.doc.nodeAt(imagePosition), getPos: () => imagePosition,
    }, attrs),
  }));
  editor.on("update", ({ transaction }) => { updates.push(transaction); render(); });
  const loadImage = async () => React.act(async () => {
    const image = document.querySelector("img");
    Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
    image.onload();
  });
  const event = async (target, type, clientX) => React.act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX }));
    context.mock.timers.runAll();
  });
  try {
    await React.act(async () => render());
    await run({ editor, updates, loadImage, event });
  } finally {
    await React.act(async () => reactRoot.unmount());
    editor.destroy();
    dom.window.close();
    context.mock.timers.reset();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

function imageHtml(width, height) {
  return `<p>Saved text<img src="${source}"${width ? ` width="${width}"` : ""}${height ? ` height="${height}"` : ""}></p>`;
}

test("page content rendering retains saved image dimensions after access consolidation", () => {
  const rendered = renderPageContent({ content: imageHtml("430", "287"), contentType: "html" });
  assert.equal(rendered.html, imageHtml("430", "287"));
  assert.equal(rendered.text, "Saved text");
});

for (const height of ["287", "286.6666666666667"]) {
  test(`page resize round-trip preserves width on image load with height ${height}`, async (context) => {
    let saved;
    await withMedia(context, imageHtml("480", "320"), async ({ editor, updates, loadImage, event }) => {
      await loadImage();
      const image = document.querySelector("img");
      Object.defineProperties(image, { width: { get: () => Number(editor.state.doc.nodeAt(imagePosition).attrs.width) }, height: { get: () => Number(editor.state.doc.nodeAt(imagePosition).attrs.height) } });
      await event(document.querySelector(".horizontal-resize-handle"), "mousedown", 480);
      await event(document, "mousemove", 430);
      await event(document, "mouseup", 430);
      assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.width), "430");
      assert.ok(updates.some((transaction) => transaction.docChanged), "resizing must trigger the page update listener");
      await React.act(async () => {
        editor.commands.command(({ tr }) => { tr.setNodeMarkup(imagePosition, undefined, { ...editor.state.doc.nodeAt(imagePosition).attrs, height }); return true; });
      });
      saved = renderPageContent({ content: editor.getHTML(), contentType: "html" }).html;
      assert.match(saved, /width="430"/);
      assert.match(saved, /Saved text/);
      assert.doesNotMatch(saved, /style=/);
      if (height.includes(".")) assert.doesNotMatch(saved, /height=/);
    });
    await withMedia(context, saved, async ({ editor, updates, loadImage }) => {
      assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.width), "430", "HTML parsing must retain the saved width");
      await loadImage();
      assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.width), "430", "loading the image must not reset the saved width to 480");
      assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.height), "287");
      assert.equal(updates.length, height.includes(".") ? 1 : 0, "only a missing height should need an update");
      assert.equal(document.querySelector("img").style.width, "430px");
      await loadImage();
      assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.width), "430", "repeated load events must preserve width");
    });
  });
}

test("ticket description HTML uses the same node view and retains saved dimensions", async (context) => {
  await withMedia(context, imageHtml("430", "286.6666666666667"), async ({ editor, updates, loadImage }) => {
    await loadImage();
    assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.width), "430");
    assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.height), "286.6666666666667");
    assert.equal(updates.length, 0, "opening saved media should not dirty the document");
  });
});

for (const width of [undefined, "100%", "0", "invalid"]) {
  test(`images without a usable saved width (${width}) still get initial dimensions`, async (context) => {
    await withMedia(context, imageHtml(width), async ({ editor, loadImage }) => {
      await loadImage();
      assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.width), "480");
      assert.equal(String(editor.state.doc.nodeAt(imagePosition).attrs.height), "320");
    });
  });
}
