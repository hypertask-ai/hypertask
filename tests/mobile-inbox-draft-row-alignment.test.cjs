const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");

let rowFill = false;
const { default: InboxDraftRow } = loadModule("src/components/notifications/InboxDraftRow.tsx", {
  "@/hooks/useFlag": { useFlag: () => rowFill },
  "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
  "@tanstack/react-query": { useQueryClient: () => ({}) },
});

function renderRow() {
  const draft = { id: 1, task: { title: "Draft task" }, content: "Draft preview", updatedAt: "2026-10-03T23:30:00.000Z" };
  const html = renderToStaticMarkup(React.createElement(InboxDraftRow, {
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
