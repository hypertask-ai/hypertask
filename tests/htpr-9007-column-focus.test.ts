import assert from "node:assert/strict";
import test from "node:test";
import { focusKanbanCard } from "../src/utils/helperFunctions/Kanban/columnFocus";

const { JSDOM } = require("jsdom");

type Box = {
  top: number;
  height: number;
  clientHeight: number;
  scrollHeight: number;
  overflowY?: string;
};

const measure = (element: HTMLElement, box: Box) => {
  element.getBoundingClientRect = () => ({
    top: box.top,
    bottom: box.top + box.height,
    left: 0,
    right: 280,
    width: 280,
    height: box.height,
    x: 0,
    y: box.top,
    toJSON() {
      return {};
    },
  });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: box.clientHeight });
  Object.defineProperty(element, "clientTop", { configurable: true, value: 0 });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: box.scrollHeight });
  let scrollTop = 0;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  if (box.overflowY) element.style.overflowY = box.overflowY;
};

const columnDom = () => {
  const { document } = new JSDOM(`<div id="droppable-section-container-4">
    <div class="task-detail-heading-tag"></div>
    <div id="tasks-list-0"><div id="task-9" tabindex="0">card</div></div>
  </div>`).window;
  const column = document.getElementById("droppable-section-container-4") as HTMLElement;
  const list = document.getElementById("tasks-list-0") as HTMLElement;
  const card = document.getElementById("task-9") as HTMLElement;
  return { column, list, card };
};

test("j and k scroll the column when the card list reports overflow but cannot move", () => {
  const { column, list, card } = columnDom();
  measure(column, { top: 0, height: 200, clientHeight: 200, scrollHeight: 2000, overflowY: "auto" });
  measure(list, { top: 40, height: 800, clientHeight: 800, scrollHeight: 800, overflowY: "auto" });
  measure(card, { top: 400, height: 40, clientHeight: 40, scrollHeight: 40 });

  focusKanbanCard(card, { scrollRealColumn: true });

  assert.equal(column.scrollTop, 240);
  assert.equal(list.scrollTop, 0);
  assert.equal(card.ownerDocument.activeElement, card);
  console.log("htpr-9007-column-scroll-ok");
});

test("a card list that really overflows still scrolls, and the column stays put", () => {
  const { column, list, card } = columnDom();
  measure(column, { top: 0, height: 400, clientHeight: 400, scrollHeight: 400, overflowY: "auto" });
  measure(list, { top: 0, height: 200, clientHeight: 200, scrollHeight: 900, overflowY: "auto" });
  measure(card, { top: 360, height: 40, clientHeight: 40, scrollHeight: 40 });

  focusKanbanCard(card, { scrollRealColumn: true });

  assert.equal(list.scrollTop, 200);
  assert.equal(column.scrollTop, 0);
});

test("without the fix, a list that only looks scrollable still takes the scroll", () => {
  const { column, list, card } = columnDom();
  measure(column, { top: 0, height: 200, clientHeight: 200, scrollHeight: 2000, overflowY: "auto" });
  measure(list, { top: 0, height: 200, clientHeight: 200, scrollHeight: 200, overflowY: "auto" });
  measure(card, { top: 300, height: 40, clientHeight: 40, scrollHeight: 40 });

  focusKanbanCard(card);

  assert.equal(list.scrollTop, 140);
  assert.equal(column.scrollTop, 0);
});
