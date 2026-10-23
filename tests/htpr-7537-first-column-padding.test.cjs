const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-7537-first-column-padding";

function fixture({ enabled = true, width = 800, owner = "wrapper", empty = false, padding = 24 } = {}) {
  const ui = mount();
  let activeSection = 1;
  let activeItem = empty ? null : 2;
  const atoms = { activeItemAtom: "item", activeSectionAtom: "section", currentProjectAtom: "project" };
  const sections = [10, 20, 30, 40].map((sectionId, index) => ({
    sectionId, items: empty ? [] : [{ id: index + 1, sectionId }],
  }));
  const wrapper = document.createElement("div");
  wrapper.className = "homepage-container-tag";
  wrapper.innerHTML = `<div id="kanban-sections-container"><div id="sectionsContainer">${sections.map((section, index) =>
    `<div tabindex="-1" class="section-container"><div id="droppable-section-container-${section.sectionId}"><div id="tasks-list-${index}">${empty ? "" :
      `<div tabindex="-1" id="task-${index + 1}"></div>`}</div></div></div>`).join("")}</div></div>`;
  document.body.append(wrapper);
  const board = document.getElementById("kanban-sections-container");
  const strip = document.getElementById("sectionsContainer");
  const scroller = { wrapper, board, strip, page: document.documentElement }[owner];
  Object.defineProperty(document, "scrollingElement", { value: document.documentElement });
  scroller.style.overflowX = "auto";
  Object.defineProperties(scroller, { clientWidth: { value: width }, scrollWidth: { value: 1600 } });
  scroller.getBoundingClientRect = () => ({ left: 0, right: width, top: 0, bottom: 700 });
  scroller.scrollBy = ({ left }) => { scroller.scrollLeft = Math.max(0, scroller.scrollLeft + left); };
  for (const [index, column] of Array.from(strip.children).entries()) {
    Object.defineProperties(column, { offsetParent: { value: strip }, clientHeight: { value: 700 } });
    column.getBoundingClientRect = () => ({
      left: padding + index * 340 - scroller.scrollLeft,
      right: padding + index * 340 + 320 - scroller.scrollLeft,
      top: 0, bottom: 700,
    });
    const droppable = column.querySelector('[id^="droppable-section-container-"]');
    droppable.getBoundingClientRect = column.getBoundingClientRect;
    Object.defineProperty(droppable, "clientHeight", { value: 700 });
    const card = column.querySelector('[id^="task-"]');
    if (card) card.getBoundingClientRect = () => ({ top: 100, bottom: 150 });
  }
  const load = loader({
    "@/store": atoms,
    jotai: { useStore: () => ({ get: atom => atom === atoms.activeItemAtom ? activeItem : activeSection }) },
    "@/lib/state": {
      useRecoilValue: () => ({ id: 15 }),
      useSetRecoilState: () => value => { activeSection = value; },
    },
    "@/hooks/useFlag": { useFlag: key => key === flagKey && enabled },
    "./General/useProjectQuery": { useProjectQuery: () => ({
      updateActiveItemAndItemInView: item => { activeItem = item?.id ?? null; },
    }) },
    "./MultiPages/useUpdateTaskInBoards": { default: () => ({}) },
    "@/utils/helperFunctions/helperFunctions": {},
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/utils/api/global": {},
    "@/utils/generateRank": {},
    "@/lib/tutorial/learnTutorialState": {},
  });
  const { useUniversalMovement } = load("src/hooks/useUniversalMovement.ts");
  const movement = useUniversalMovement({ type: "Kanban", initialSections: sections, filteredSections: sections });
  function select(index) {
    activeSection = index;
    activeItem = empty ? null : index + 1;
    (empty ? strip.children[index] : document.getElementById(`task-${index + 1}`)).focus();
  }
  select(1);
  scroller.scrollLeft = 400;
  return { ...ui, scroller, strip, movement, select };
}

for (const width of [800, 390]) {
  for (const owner of ["wrapper", "board", "strip", "page"]) {
    test(`${width}px ${owner}: left focus restores the load padding, then right focus still reveals the column`, () => {
      const f = fixture({ width, owner });
      try {
        f.movement.focus.left();
        assert.equal(f.scroller.scrollLeft, 0);
        assert.equal(f.strip.children[0].getBoundingClientRect().left, 24);
        f.select(2);
        f.scroller.scrollLeft = 0;
        f.movement.focus.right();
        assert.equal(f.scroller.scrollLeft, 24 + 3 * 340 + 320 - width);
        assert.equal(f.strip.children[3].getBoundingClientRect().right, width);
      } finally { f.close(); }
    });
  }
}

for (const enabled of [true, false]) {
  for (const scrollLeft of [0, 12, 24, 400]) {
    test(`flag ${enabled}, scrollLeft ${scrollLeft}: first-column focus ${enabled ? "resets to default" : "keeps legacy alignment"}`, () => {
      const f = fixture({ enabled });
      try {
        f.scroller.scrollLeft = scrollLeft;
        f.movement.focus.left();
        assert.equal(f.scroller.scrollLeft, enabled ? 0 : Math.min(scrollLeft, 24));
      } finally { f.close(); }
    });
  }
  test(`flag ${enabled}: a fully visible later column does not scroll`, () => {
    const f = fixture({ enabled });
    try {
      f.select(0);
      f.scroller.scrollLeft = 150;
      f.movement.focus.right();
      assert.equal(f.scroller.scrollLeft, 150);
    } finally { f.close(); }
  });
}

test("an empty first column also restores padding", () => {
  const f = fixture({ empty: true });
  try {
    f.movement.focus.left();
    assert.equal(f.scroller.scrollLeft, 0);
    assert.equal(document.activeElement, f.strip.children[0]);
  } finally { f.close(); }
});

test("first-column padding is not a hardcoded pixel offset", () => {
  const f = fixture({ padding: 48 });
  try {
    f.movement.focus.left();
    assert.equal(f.scroller.scrollLeft, 0);
    assert.equal(f.strip.children[0].getBoundingClientRect().left, 48);
  } finally { f.close(); }
});

test("the ticket bugfix flag defaults to Everyone with small release risk", () => {
  const definition = loader()(`src/lib/flags/definitions/${flagKey}.ts`).default;
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});
