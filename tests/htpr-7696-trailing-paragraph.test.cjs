const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { createJiti } = require("jiti");
const { generateJSON } = require("@tiptap/core");
const { StarterKit } = require("@tiptap/starter-kit");

const root = path.resolve(__dirname, "..");
const directory = "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/";
const jiti = createJiti(__filename, { fsCache: false, alias: { "@": path.join(root, "src") } });
const { toEditorHtml } = jiti(path.join(root, directory, "staticDescriptionHtml.ts"));
const { sanitizeDescriptionHtml } = jiti(path.join(root, "src/utils/helperFunctions/sanitizeHtml.ts"));
const source = fs.readFileSync(path.join(root, directory, "StaticDescriptionShell.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mocks = {
  "next/navigation": {},
  "@/styles/tiptap.module.scss": { default: {} },
  "@/styles/FileDragAndDrop.module.scss": { default: {} },
  "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "" } } },
  "@/lib/taskDetailInboxFlow": {},
  "@/utils/undoActions/helperFuncs": {},
  "./staticDescriptionHtml": { toEditorHtml },
  "@/utils/helperFunctions/sanitizeHtml": { sanitizeDescriptionHtml },
};
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name in mocks) return { __esModule: true, ...mocks[name] };
  return require(name);
}, loaded, loaded.exports);
const { StaticDescriptionBody } = loaded.exports;

const agentDescription = "<p>**Urgent bug: opening a ticket page, the description first shows with about 2 blank lines between every line, then jumps until it looks normal.**</p><p>Valentin, 2026-10-24: &quot;when i load a task page there is major shifting now. the text renders with 2 lines spare space in between each line and then the text shifts around till its normal that s not good pls you can&#x27;t allow shifting like that we need to keep shifting in check and in fact improve shifting ongoingly&quot;.</p><p>&quot;now&quot; means this is new: find which recent change caused it (recent deploys: the task description HTML cleaning, ticket first screen, desktop AI chat login, skill picker). If the cause sits behind a switch, ask HT Product Lead to switch it Off first, then fix.</p><p>Do:\n1. Reproduce on app.hypertask.ai: open a ticket with a multi-line description, desktop and phone. Record a layout shift trace. Name the cause (for example paragraphs rendered with extra margins or empty paragraphs before the editor or styles load).\n2. Fix so the description shows at its final spacing from the first frame.\n3. Keep it in check from now on: a layout shift budget check for the ticket page and for scrolling a board column (see HTPR-7695) that fails a PR when shift goes over the budget, plus the daily speed report tracking shift so it only gets better.\n4. Prove it: shift score before and after, desktop and phone.</p>\n";

function withDocument(t) {
  const dom = new JSDOM("");
  const previous = Object.getOwnPropertyDescriptor(global, "window");
  Object.defineProperty(global, "window", { configurable: true, value: dom.window });
  t.after(() => {
    dom.window.close();
    if (previous) Object.defineProperty(global, "window", previous);
    else delete global.window;
  });
  return dom.window.document;
}

function firstPaint(document, html, isMbl) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(React.createElement(StaticDescriptionBody, { html, isMbl }));
  const text = container.querySelector(".ProseMirror");
  assert.ok(text);
  return text;
}

for (const isMbl of [false, true]) {
  test(`first paint matches the editor's four-block agent fixture (${isMbl ? "phone" : "desktop"})`, t => {
    const document = withDocument(t);
    assert.ok(agentDescription.endsWith("</p>\n"));
    const editor = generateJSON(agentDescription, [StarterKit]);
    assert.equal(editor.content.length, 4);
    assert.ok(editor.content.every(block => block.type === "paragraph"));
    const paint = firstPaint(document, agentDescription, isMbl);
    assert.equal(paint.children.length, editor.content.length);
    assert.deepEqual(Array.from(paint.children, block => block.tagName), ["P", "P", "P", "P"]);
    assert.equal(paint.querySelector(".ProseMirror-trailingBreak"), null);
  });
}

for (const whitespace of ["\n", "\r\n", " \t\n\f", "\n\n"]) {
  test(`inter-block and trailing ${JSON.stringify(whitespace)} do not create paragraphs`, t => {
    const document = withDocument(t);
    const html = `<p>First</p>${whitespace}<p></p>${whitespace}<p>Last</p>${whitespace}`;
    const editor = generateJSON(html, [StarterKit]);
    assert.equal(editor.content.length, 3);
    const paint = firstPaint(document, html, false);
    assert.equal(paint.children.length, editor.content.length);
    assert.deepEqual(Array.from(paint.children, block => block.textContent), ["First", "", "Last"]);
    assert.equal(paint.querySelectorAll(".ProseMirror-trailingBreak").length, 1);
  });
}

test("trimming block separators leaves code whitespace and nonbreaking spaces intact", t => {
  const document = withDocument(t);
  const html = "<pre><code>first\n  second\n</code></pre><p>Last\u00a0</p>\n";
  const paint = firstPaint(document, html, false);
  const editor = generateJSON(html, [StarterKit]);
  assert.equal(paint.children.length, editor.content.length);
  assert.equal(paint.querySelector("code").textContent, "first\n  second\n");
  assert.equal(paint.querySelector("p").textContent, "Last\u00a0");
});

test("the layout-lock agentdesc seed ends with a newline", () => {
  const seed = fs.readFileSync(path.join(root, "scripts/seed-browser-smoke.mjs"), "utf8");
  const literal = /suffix: "agentdesc",\s*descriptionHtml: (\[[\s\S]*?\]\.join\("\\n\\n"\))/.exec(seed)?.[1];
  assert.ok(literal);
  const html = new Function(`return (${literal});`)();
  assert.ok(html.endsWith("</p>\n"));
});
