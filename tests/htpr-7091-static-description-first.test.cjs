// HTPR-7091: a cold ticket shows its description before the editor chunk loads.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToString } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, {
  jsx: { runtime: "automatic" },
  fsCache: false,
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const read = (file) => fs.readFileSync(path.join(dir, file), "utf8");
const { isPlainDescriptionHtml, toEditorHtml } = jiti(path.join(dir, "staticDescriptionHtml.ts"));

test("the description body no longer imports the editor statically", () => {
  const body = read("DescriptonBody.tsx");
  assert.doesNotMatch(body, /from "@\/components\/RTE\/TipTapTaskDetail"/);
  assert.match(body, /DescriptionEditorSlot/);
  assert.match(body, /HTPR_7091_STATIC_DESCRIPTION_FIRST_FLAG\) && instantTicketOpen/);
  assert.match(body, /staticFirst && !isEditing && isPlainDescriptionHtml\(linkedContent\)/);
});

test("the slot loads the editor with import() in both flag states", () => {
  const slot = read("DescriptionEditorSlot.tsx");
  assert.match(slot, /import\("@\/components\/RTE\/TipTapTaskDetail"\)/);
  assert.doesNotMatch(slot, /^import .* from "@\/components\/RTE\/TipTapTaskDetail"/m);
});

test("flag is a bugfix, default Everyone, with release risk", () => {
  const def = jiti(path.join(root, "src/lib/flags/definitions/htpr-7091-static-description-first.ts"));
  assert.equal(def.default.key, "htpr-7091-static-description-first");
  assert.equal(def.default.kind, "bugfix");
  assert.equal(def.default.defaultMode, undefined);
  assert.ok(def.default.releaseRisk);
});

// Expected values are what the read-only editor itself produced for the same input.
const EDITOR = {
  plain: ["<p>This seeded ticket must open from its board card.</p>", "<p>This seeded ticket must open from its board card.</p>"],
  lists: [
    "<p>Intro <strong>b</strong> <em>i</em></p><ul><li>First</li><li>Third<ul><li>Nested</li></ul></li></ul><ol><li>Step</li></ol>",
    '<p>Intro <strong>b</strong> <em>i</em></p><ul><li><p>First</p></li><li><p>Third</p><ul><li><p>Nested</p></li></ul></li></ul><ol class="numbered-list"><li><p>Step</p></li></ol><p><br class="ProseMirror-trailingBreak"></p>',
  ],
  blank: [
    "<p>One<br>two</p><p></p><p>Last <b>bold</b> <i>ital</i></p>",
    '<p>One<br>two</p><p><br class="ProseMirror-trailingBreak"></p><p>Last <strong>bold</strong> <em>ital</em></p>',
  ],
  link: [
    '<p>Go <a href="https://example.com/a">there</a></p>',
    '<p>Go <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/a">there</a></p>',
  ],
  heading: ["<h1>Big</h1><p>Text</p><h3>Small</h3><p>End</p>", "<h1>Big</h1><p>Text</p><h3>Small</h3><p>End</p>"],
};

for (const [name, [raw, expected]] of Object.entries(EDITOR)) {
  test(`static html matches the editor for ${name}`, () => {
    assert.equal(isPlainDescriptionHtml(raw), true);
    assert.equal(toEditorHtml(raw), expected);
  });
}

test("content the static copy cannot match keeps the editor-first path", () => {
  for (const raw of [
    "",
    "   ",
    null,
    "just text",
    "<p>Hi</p>text after",
    '<p><img src="x.png"></p>',
    '<p>Hi <span data-type="mention" data-id="1">@QA</span></p>',
    "<pre><code>a</code></pre>",
    "<blockquote><p>q</p></blockquote>",
    '<p style="color:red">x</p>',
    '<p class="x">x</p>',
    "<div><p>x</p></div>",
    "<p>x<br></p>",
    "<table><tr><td>x</td></tr></table>",
    '<p><a href="x" onclick="y">l</a></p>',
    "<ul><li><h2>x</h2></li></ul>",
    "<p>trailing space </p>",
    "<p> leading space</p>",
    "<p>two  spaces</p>",
    "<ul>\n<li>newline between tags</li>\n</ul>",
    "<ul><li>a</li> <li>b</li></ul>",
    "<p>a<br> b</p>",
    "<p>unclosed",
    "<p><iframe src='x'></iframe></p>",
  ]) {
    assert.equal(isPlainDescriptionHtml(raw), false, String(raw));
  }
});

test("linkified content stays in the static subset", () => {
  const { linkifyHtml } = jiti(path.join(root, "src/utils/helperFunctions/linkifyHtml.ts"));
  assert.equal(isPlainDescriptionHtml(linkifyHtml("<p>see https://example.com/x now</p>")), true);
});

const ts = require("typescript");
const noop = () => {};
const styleNames = new Proxy({}, { get: (_, name) => (name === "__esModule" ? true : String(name)) });
function load(file, mocks) {
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (specifier) => mocks[specifier] ?? (specifier.startsWith("@/")
      ? jiti(path.join(root, "src", specifier.slice(2))) : require(specifier)),
    mod, mod.exports,
  );
  return mod.exports;
}
const shellMocks = {
  "next/navigation": { useRouter: () => ({ push: noop }), useSearchParams: () => new URLSearchParams() },
  "@/styles/tiptap.module.scss": { __esModule: true, default: styleNames },
  "@/styles/FileDragAndDrop.module.scss": { __esModule: true, default: styleNames },
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  "./staticDescriptionHtml": { toEditorHtml },
};
const shell = load("StaticDescriptionShell.tsx", shellMocks);

test("lazy slot renders the static description first, in the editor's wrapper", () => {
  const slot = load("DescriptionEditorSlot.tsx", {
    "next/dynamic": { __esModule: true, default: () => () => null },
    "./StaticDescriptionShell": shell,
    "./StaticDescriptionPlaceholder": load("StaticDescriptionPlaceholder.ts", {}),
  });
  const html = renderToString(
    React.createElement(slot.default, {
      lazy: true,
      defaultContent: "<p>static description</p>",
      isMbl: false,
      mode: "read-edit-description",
      id: "description",
    }),
  );
  assert.match(html, /id="main-wrapper-description"/);
  assert.match(html, /id="description-input"/);
  assert.match(html, /contentEditable="false"|contenteditable="false"/);
  assert.match(html, /<p>static description<\/p>/);
});

test("phone shell uses the phone container, desktop the drag container", () => {
  const phone = renderToString(React.createElement(shell.StaticDescriptionBody, { html: "<p>x</p>", isMbl: true }));
  const desktop = renderToString(React.createElement(shell.StaticDescriptionBody, { html: "<p>x</p>", isMbl: false }));
  assert.match(phone, /min-h-\[78px\]/);
  assert.doesNotMatch(desktop, /min-h-\[78px\]/);
  assert.match(desktop, /flex flex-col/);
});

test("the static copy sets the rules the editor adds for its root", () => {
  const html = renderToString(React.createElement(shell.StaticDescriptionBody, { html: "<p>x</p>", isMbl: false }));
  assert.match(html, /white-space:break-spaces/);
  assert.match(html, /word-wrap:break-word/);
  assert.match(html, /font-variant-ligatures:none/);
  assert.match(html, /position:relative/);
});

test("the editor panels show the static placeholder only when one is provided", () => {
  const panels = fs.readFileSync(path.join(root, "src/components/RTE/TaskDetailEditorPanels.tsx"), "utf8");
  assert.match(panels, /staticPlaceholder \?\? <InnerHTMLDescription/);
});
