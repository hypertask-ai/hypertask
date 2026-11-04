const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createRequire } = require("node:module");
const ts = require("typescript");
require("tsx/cjs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");

const file = path.resolve(__dirname, "../src/components/notifications/InboxDraftRow.tsx");
const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
let rowFill = false;
const component = { exports: {} };
const realRequire = createRequire(file);
new Function("require", "module", "exports", code)((id) => {
  if (id === "@/hooks/useFlag") return { useFlag: () => rowFill };
  if (id === "@/lib/firstScreen/SurfaceContext") return { useFirstScreenSurface: () => null };
  if (id === "@tanstack/react-query") return { useQueryClient: () => ({}) };
  return realRequire(id);
}, component, component.exports);

function renderRow() {
  const draft = { id: 1, task: { title: "Draft task" }, content: "Draft preview", updatedAt: "2026-10-03T23:30:00.000Z" };
  const html = renderToStaticMarkup(React.createElement(component.exports.default, {
    draft, activeDrafts: [draft], userId: 1, selected: false, onFocus: () => {}, onOpen: () => {},
  }));
  return new JSDOM(html).window.document;
}

for (const enabled of [false, true]) {
  test(`the draft row keeps its inset and flag-controlled rounding (${enabled})`, () => {
    rowFill = enabled;
    const button = renderRow().querySelector('button[data-inbox-draft-control="true"]');
    assert.ok(button, "open-draft button must render");
    assert.ok(button.classList.contains("px-5"));
    assert.ok(button.classList.contains("md:px-0"));
    assert.ok(button.classList.contains(enabled ? "rounded" : "rounded-md"));
    assert.ok(!button.classList.contains(enabled ? "rounded-md" : "rounded"));
  });
}

test("the draft row container keeps the shared inbox horizontal padding", () => {
  const container = renderRow().querySelector(".group\\/draft-row");
  assert.ok(container, "draft row container must render");
  assert.ok(container.classList.contains("sm:p-inbox-horizontal"));
  assert.ok(container.classList.contains("md:p-0"));
});
