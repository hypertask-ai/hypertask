const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { interopDefault: true, cache: false });
const { focusKanbanCard } = jiti(
  path.join(root, "src/utils/helperFunctions/Kanban/columnFocus.ts"),
);

function fixture({ top, bottom, mobile = false, sticky = true }) {
  const dom = new JSDOM(`<div id="kanban-sections-container"><div
    id="droppable-section-container-1"><div class="task-detail-heading-tag"
    style="position:${sticky ? "sticky" : "static"}"></div><div id="tasks-list-0"
    style="overflow-y:${mobile ? "auto" : "visible"}"><div id="task-1"
    tabindex="-1"></div></div></div></div>`);
  const { document } = dom.window;
  const board = document.getElementById("kanban-sections-container");
  const column = document.getElementById("droppable-section-container-1");
  const list = document.getElementById("tasks-list-0");
  const card = document.getElementById("task-1");
  const header = document.querySelector(".task-detail-heading-tag");
  column.getBoundingClientRect = () => ({ top: 100, bottom: 502 });
  list.getBoundingClientRect = () => ({ top: 130, bottom: 500 });
  header.getBoundingClientRect = () => ({ top: 101, bottom: 130 });
  card.getBoundingClientRect = () => ({ top, bottom });
  Object.defineProperties(column, {
    clientTop: { value: 1 }, clientHeight: { value: 400 },
  });
  Object.defineProperty(list, "clientHeight", { value: 370 });
  column.scrollTop = 200;
  list.scrollTop = 200;
  board.scrollLeft = 123;
  let focusOptions;
  const nativeFocus = card.focus.bind(card);
  card.focus = (options) => { focusOptions = options; nativeFocus(options); };
  return { dom, document, board, column, list, card, getFocusOptions: () => focusOptions };
}

for (const [name, bounds, expected] of [
  ["fully visible card stays still", { top: 150, bottom: 250 }, 200],
  ["card below scrolls only the clipped amount", { top: 450, bottom: 550 }, 249],
  ["card under the sticky header scrolls just clear of it", { top: 110, bottom: 210 }, 180],
  ["card above scrolls up to the sticky header", { top: 50, bottom: 150 }, 120],
  ["oversized card spanning the viewport stays still", { top: 50, bottom: 600 }, 200],
  ["oversized card below aligns its top", { top: 450, bottom: 950 }, 520],
  ["oversized card above aligns its bottom", { top: -400, bottom: 150 }, -151],
  ["non-sticky header does not reduce the viewport", { top: 110, bottom: 210, sticky: false }, 200],
]) {
  test(name, () => {
    const f = fixture(bounds);
    try {
      focusKanbanCard(f.card);
      assert.deepEqual(f.getFocusOptions(), { preventScroll: true });
      assert.equal(f.document.activeElement, f.card);
      assert.equal(f.column.scrollTop, expected);
      assert.equal(f.list.scrollTop, 200);
      assert.equal(f.board.scrollTop, 0);
      assert.equal(f.board.scrollLeft, 123);
    } finally { f.dom.window.close(); }
  });
}

test("mobile scrolls the task list, not the outer column or board", () => {
  const f = fixture({ top: 450, bottom: 550, mobile: true });
  try {
    focusKanbanCard(f.card);
    assert.equal(f.list.scrollTop, 250);
    assert.equal(f.column.scrollTop, 200);
    assert.equal(f.board.scrollTop, 0);
    assert.equal(f.board.scrollLeft, 123);
  } finally { f.dom.window.close(); }
});

test("missing card is harmless and a detached card still receives safe focus", () => {
  focusKanbanCard(null);
  const dom = new JSDOM('<div tabindex="-1"></div>');
  try {
    const card = dom.window.document.querySelector("div");
    focusKanbanCard(card);
    assert.equal(dom.window.document.activeElement, card);
  } finally { dom.window.close(); }
});

test("J/K and arrows use column-only focus while preserving List navigation", () => {
  const source = fs.readFileSync(path.join(root, "src/hooks/useUniversalMovement.ts"), "utf8");
  const focus = source.slice(source.indexOf("const focus = {"), source.indexOf("left: (forceNavigate"));
  assert.equal((focus.match(/focusKanbanCard\(activeElement_\)/g) || []).length, 2);
  assert.equal((focus.match(/focusKanbanCard\(document\.getElementById\(tasksList\[0\]\.id\)\)/g) || []).length, 2);
  assert.match(focus, /props\.type === "List"/);
  const refocus = source.slice(source.indexOf("function refocus("), source.indexOf("async function moveTaskHorizontally"));
  assert.match(refocus, /props\.type === "Kanban"/);
  assert.match(refocus, /focusKanbanCard\(element\)/);
  const helper = fs.readFileSync(path.join(root, "src/utils/helperFunctions/Kanban/columnFocus.ts"), "utf8");
  assert.match(helper, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(helper, /scrollIntoView/);
});

test("board row is bounded so hidden overflow cannot scroll the headers away", () => {
  const source = fs.readFileSync(path.join(root, "src/styles/globals.scss"), "utf8");
  const start = source.indexOf("#sectionsContainer {");
  const row = source.slice(start, source.indexOf("}", start));
  assert.match(row, /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(source, /overflow-x: auto;\s*overflow-y: hidden;/);
});
