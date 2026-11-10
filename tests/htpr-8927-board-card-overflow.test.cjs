const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loader, React } = require("./helpers/htpr-7260-ui.cjs");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("board column containers clip horizontal overflow", () => {
  const source = read("src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx");
  assert.match(source, /section-container relative min-w-0 overflow-x-hidden/);
  assert.match(source, /overflow-x-hidden overflow-y-auto/);
  assert.match(source, /w-full min-w-0 max-w-full overflow-x-hidden px-2 space-y-4 mt-0/);
});

test("kanban cards clamp wide link content", () => {
  const source = read("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx");
  assert.match(source, /kanban-task-card[^\n]*min-w-0 max-w-full/);
  assert.match(source, /flex min-w-0 w-full max-w-full[^\n]*overflow-hidden/);
});

test("blocker chips and tag row truncate inside the card width", () => {
  const blocker = read("src/components/PageComponents/Kanban/KanbanTaskComponents/BlockerChip.tsx");
  assert.match(blocker, /min-w-0 max-w-full[^\n]*overflow-hidden/);

  const tags = read("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx");
  assert.match(tags, /basis-full flex min-w-0 max-w-full flex-wrap gap-1 overflow-hidden/);
  assert.match(tags, /nowrap/);
});

test("a long blocker chip does not widen a fixed column", () => {
  const BlockerTaskChip = loader({
    "@/hooks/MultiPages/Route/useHypertasksNavigate": {
      default: () => ({ navigateToTask: () => {} }),
    },
    "@/components/Common/UserAvatar": { default: () => null },
  })("src/components/PageComponents/Kanban/KanbanTaskComponents/BlockerChip.tsx").BlockerTaskChip;

  const html = renderToStaticMarkup(
    React.createElement(
      "div",
      { style: { width: "260px" } },
      React.createElement(BlockerTaskChip, {
        task: {
          id: 1,
          projectId: 15,
          uniqueIndex: 8927,
          ticketNumber: "HTPR-8927",
          title: "x".repeat(200),
        },
      }),
    ),
  );
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  try {
    const chip = dom.window.document.querySelector("[data-blocking-task]");
    const column = dom.window.document.body.firstElementChild;
    assert.ok(chip, "blocker chip rendered");
    assert.ok(chip.className.includes("min-w-0"));
    assert.equal(column.scrollWidth, column.clientWidth);
  } finally {
    dom.window.close();
  }
});
