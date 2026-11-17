const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loader, React } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-9070-calm-focus-bar";
const componentPath = "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`);
const cleanupFlag = loader()("src/lib/flags/definitions/htpr-8255-kanban-cleanup.ts");
const overflowFlag = loader()("src/lib/flags/definitions/htpr-8927-board-card-overflow.ts");
const MobileViewContext = React.createContext(false);
const noop = () => {};
const cn = loader({
  "@/lib/constants/APIRouteConstants": {},
  "@/lib/realtime/client": {},
  "../api/global": {},
})("src/utils/undoActions/helperFuncs.ts").cn;

function render(enabled, props = {}) {
  const Component = loader({
    "@/hooks/useFlag": {
      useFlag: (key) =>
        (key === flagKey && enabled) ||
        key === cleanupFlag.default.key ||
        key === overflowFlag.default.key,
    },
    "@/lib/flags/keys": {},
    "@/lib/flags/definitions/htpr-8255-kanban-cleanup": cleanupFlag,
    "@/lib/flags/definitions/htpr-8927-board-card-overflow": overflowFlag,
    "@/lib/flags/definitions/htpr-9070-calm-focus-bar": flag,
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/utils/undoActions/helperFuncs": { cn },
    "next/link": { default: ({ prefetch, ...rest }) => React.createElement("a", rest) },
  })(componentPath).default;
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(MobileViewContext.Provider, { value: false },
    React.createElement(Component, {
      active: false, taskHref: "/detail/project-15/9070", openDetail: noop,
      ...props,
    }, "Task title"))));
  const card = dom.window.document.body.firstElementChild;
  const link = card.querySelector("a");
  const bar = card.querySelector("[data-focus-bar]");
  const result = { dom, card, link, bar, classes: [...card.classList], linkClass: link.className };
  return result;
}

test("the calm focus bar ships as a bugfix on for everyone with small risk", () => {
  assert.equal(flag.default.key, flagKey);
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
});

test("focus paints a bar inside the card without changing border or padding", () => {
  const plain = render(true);
  const focused = render(true, { active: true });
  try {
    assert.ok(plain.classes.includes("border-l-0"));
    assert.ok(focused.classes.includes("border-l-0"));
    assert.ok(!focused.classes.includes("border-l-4"));
    assert.equal(focused.linkClass, plain.linkClass);
    assert.equal(plain.bar, null);
    assert.ok(focused.bar);
    assert.ok(focused.bar.className.includes("absolute"));
    assert.ok(focused.bar.className.includes("w-[3px]"));
    assert.ok(focused.bar.className.includes("bg-white-black"));
  } finally {
    plain.dom.window.close();
    focused.dom.window.close();
  }
});

test("moving focus never changes the card's layout classes", () => {
  const layout = (rendered) => rendered.classes
    .filter((name) => /^(?:border(?:-[ltrb])?-(?:\d|\[)|p[trblxy]?-(?:\d|\[))/.test(name))
    .sort();
  const plain = render(true);
  const focused = render(true, { active: true });
  try {
    assert.deepEqual(layout(focused), layout(plain));
  } finally {
    plain.dom.window.close();
    focused.dom.window.close();
  }
});

test("blocked cards keep their red stroke and no focus overlay", () => {
  const blocked = render(true, { active: true, blocked: true });
  try {
    assert.ok(blocked.classes.includes("border-l-4"));
    assert.ok(blocked.classes.includes("border-[hsl(0_62.8%_30.6%)]"));
    assert.equal(blocked.bar, null);
  } finally {
    blocked.dom.window.close();
  }
});

test("switching the flag off restores the border bar for focused cards", () => {
  const focused = render(false, { active: true });
  try {
    assert.ok(focused.classes.includes("border-l-4"));
    assert.ok(focused.classes.includes("border-white-black"));
    assert.equal(focused.bar, null);
    assert.ok(focused.linkClass.includes("p-2"));
  } finally {
    focused.dom.window.close();
  }
});
