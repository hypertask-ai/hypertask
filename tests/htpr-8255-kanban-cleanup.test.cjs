const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loader, React } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-8255-kanban-cleanup";
const componentPath = "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`);
const overflowFlag = loader()("src/lib/flags/definitions/htpr-8927-board-card-overflow.ts");
const MobileViewContext = React.createContext(false);
const noop = () => {};
const cn = loader({
  "@/lib/constants/APIRouteConstants": {},
  "@/lib/realtime/client": {},
  "../api/global": {},
})("src/utils/undoActions/helperFuncs.ts").cn;

function render(enabled, mobile, props = {}) {
  const Component = loader({
    "@/hooks/useFlag": {
      useFlag: (key) => key === flagKey && enabled,
    },
    "@/lib/flags/keys": flag,
    "@/lib/flags/definitions/htpr-8255-kanban-cleanup": flag,
    "@/lib/flags/definitions/htpr-8927-board-card-overflow": overflowFlag,
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/utils/undoActions/helperFuncs": { cn },
    "next/link": { default: ({ prefetch, ...rest }) => React.createElement("a", rest) },
  })(componentPath).default;
  return renderToStaticMarkup(React.createElement(MobileViewContext.Provider, { value: mobile },
    React.createElement(Component, {
      active: false, taskHref: "/detail/project-15/8255", openDetail: noop,
      ...props,
    }, "Task title")));
}

function parts(enabled, mobile, props) {
  const dom = new JSDOM(render(enabled, mobile, props));
  try {
    const card = dom.window.document.body.firstElementChild;
    return { card: [...card.classList], link: [...card.querySelector("a").classList] };
  } finally {
    dom.window.close();
  }
}

test("the flag ships as an improvement on for everyone with small risk", () => {
  assert.equal(flag.default.key, flagKey);
  assert.equal(flag.default.kind, "improvement");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
});

for (const mobile of [false, true]) {
  test(`${mobile ? "phone" : "desktop"} plain cards drop the hidden stroke and keep content 12px in`, () => {
    const on = parts(true, mobile, {});
    const off = parts(false, mobile, {});
    assert.ok(off.card.includes("rounded-[5px]"));
    assert.ok(off.card.includes("border-transparent"));
    assert.ok(on.card.includes("rounded-[5px]"), "the card keeps the canonical radius");
    assert.ok(!on.card.includes("border-transparent"));
    assert.ok(on.card.includes("border-l-0"));
    assert.ok(on.card.includes(mobile ? "shadow-sm" : "shadow-md"));
    assert.ok(!on.card.includes("hover:shadow-md"), "hover never raises a second shadow");
    assert.deepEqual(on.link.sort(), ["flex", "flex-wrap", "gap-1.5", "items-center", "pl-3", "pr-2", "py-2"].sort());
  });

  test(`${mobile ? "phone" : "desktop"} active and blocked cards carry one 4px stroke and 8px padding`, () => {
    for (const [props, stroke] of [
      [{ active: true }, "border-white-black"],
      [{ blocked: true }, "border-[hsl(0_62.8%_30.6%)]"],
      [{ active: true, blocked: true }, "border-[hsl(0_62.8%_30.6%)]"],
    ]) {
      const on = parts(true, mobile, props);
      assert.ok(on.card.includes("border-l-4"), `${JSON.stringify(props)} keeps the 4px stroke`);
      assert.ok(!on.card.includes("hover:shadow-md"), "a stroked card keeps one shadow");
      assert.ok(on.card.includes(stroke));
      assert.ok(!on.card.includes("border-l-[3px]"), "the blocked stripe is no longer 3px");
      assert.ok(on.link.includes("p-2"));
      assert.ok(!on.link.includes("pl-3"));
    }
  });

  test(`${mobile ? "phone" : "desktop"} flag off keeps today's card exactly`, () => {
    for (const [props, state] of [
      [{}, "border-transparent bg-cardBackground hover:bg-hoverCardBackground hover:shadow-md"],
      [{ blocked: true }, "border-[hsl(0_62.8%_30.6%)] bg-cardBackground hover:bg-hoverCardBackground hover:shadow-md"],
      [{ active: true }, "border-white-black bg-kanban-active-cardbg hover:bg-hover-active"],
    ]) {
      const off = parts(false, mobile, props);
      const stroke = props.blocked ? "border-l-[3px]" : "border-l-4";
      assert.equal(off.card.join(" "),
        `${mobile ? "shadow-sm" : "shadow-md"} ${stroke} ${state} kanban-task-card group/kanban-selection relative rounded-[5px] outline-none cursor-pointer`);
      assert.equal(off.link.join(" "), "flex items-center p-2 gap-1.5 flex-wrap");
    }
  });
}
