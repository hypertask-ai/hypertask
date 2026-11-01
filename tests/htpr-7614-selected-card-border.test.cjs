const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const postcss = require("postcss");
const { compile } = require("@tailwindcss/node");
const { loader, React, root } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-7614-selected-card-border";
const componentPath = "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`);
const MobileViewContext = React.createContext(false);
const noop = () => {};
const cn = loader({
  "@/lib/constants/APIRouteConstants": {},
  "@/lib/realtime/client": {},
  "../api/global": {},
})("src/utils/undoActions/helperFuncs.ts").cn;

function render(enabled, mobile, props = {}) {
  const Component = loader({
    "@/hooks/useFlag": { useFlag: key => key === flagKey && enabled },
    "@/lib/flags/keys": flag,
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/utils/undoActions/helperFuncs": { cn },
    "next/link": { default: ({ prefetch, ...rest }) => React.createElement("a", rest) },
  })(componentPath).default;
  return renderToStaticMarkup(React.createElement(MobileViewContext.Provider, { value: mobile },
    React.createElement(Component, {
      active: false, taskHref: "/detail/project-15/7614", openDetail: noop,
      selectionControl: React.createElement("button", { "aria-label": "Select card" }),
      ...props,
    }, "Task title")));
}

function classes(enabled, mobile, props) {
  const dom = new JSDOM(render(enabled, mobile, props));
  try {
    return [...dom.window.document.body.firstElementChild.classList];
  } finally {
    dom.window.close();
  }
}

for (const mobile of [false, true]) {
  test(`${mobile ? "phone" : "desktop"} selected cards replace only the inset ring, preserving layout and contents`, () => {
    for (const blocked of [false, true]) {
      for (const active of [false, true]) {
        const props = { selected: true, blocked, active };
        const on = classes(true, mobile, props);
        const off = classes(false, mobile, props);
        for (const legacy of ["ring-1", "ring-inset", "ring-hypertasks-purple"]) {
          assert.ok(off.includes(legacy));
        }
        assert.ok(!on.some(name => name.startsWith("ring-")), "no inset selection shadow remains");
        const selectionPaint = name => /^(?:!?outline(?:-|$)|!?-outline-offset-|ring-)/.test(name);
        assert.deepEqual(on.filter(name => !selectionPaint(name)), off.filter(name => !selectionPaint(name)),
          "border widths, radius, backgrounds, spacing and shadows must stay unchanged");
        assert.ok(on.includes(blocked ? "border-l-[3px]" : "border-l-4"));
        assert.ok(on.includes("rounded-[5px]"));
        assert.equal(render(true, mobile, props).replace(/class="[^"]*"/, ""),
          render(false, mobile, props).replace(/class="[^"]*"/, ""));
      }
    }
  });

  test(`${mobile ? "phone" : "desktop"} unselected and active cards are byte-for-byte unchanged`, () => {
    for (const blocked of [false, true]) {
      for (const active of [false, true]) {
        assert.equal(render(true, mobile, { blocked, active }), render(false, mobile, { blocked, active }));
      }
    }
  });

  test(`${mobile ? "phone" : "desktop"} flag off preserves the original selected card classes`, () => {
    for (const [blocked, expected] of [
      [false, "border-l-4 ring-1 ring-inset ring-hypertasks-purple border-transparent"],
      [true, "border-l-[3px] ring-1 ring-inset ring-hypertasks-purple border-[hsl(0_62.8%_30.6%)]"],
    ]) {
      assert.equal(classes(false, mobile, { selected: true, blocked }).join(" "),
        `${mobile ? "shadow-sm" : "shadow-md"} ${expected} bg-kanban-active-cardbg hover:bg-hover-active kanban-task-card group/kanban-selection relative rounded-[5px] outline-none cursor-pointer`);
    }
  });
}

test("selection compiles to an important one-pixel border-box outline, independent of theme shadows and radius", async () => {
  const on = classes(true, true, { selected: true, blocked: true });
  const off = classes(false, true, { selected: true, blocked: true });
  const added = on.filter(name => !off.includes(name));
  const compiler = await compile('@import "./src/styles/tailwind-entry.css";', { base: root, onDependency: noop });
  const css = postcss.parse(compiler.build(added));
  const declarations = new Map();
  css.walkDecls(decl => {
    const selector = decl.parent.selector?.replace(/\\(.)/g, "$1");
    if (!added.some(name => selector === `.${name}`)) return;
    assert.ok(decl.important, `${decl.prop} must beat unlayered theme rules`);
    declarations.set(decl.prop, decl.value);
    for (let parent = decl.parent; parent; parent = parent.parent) {
      assert.ok(parent.type !== "atrule" || parent.name !== "media", "selection must work at every viewport width");
    }
  });
  assert.equal(declarations.get("--tw-outline-style"), "solid", "outline-none cannot reset the selected style");
  assert.match(declarations.get("outline-style"), /^(?:solid|var\(--tw-outline-style\))$/);
  assert.equal(declarations.get("outline-width"), "1px");
  assert.match(declarations.get("outline-offset"), /^(?:-1px|calc\(1px \* -1\)|calc\(-1px\))$/, "the line sits on the card's own outer edge");
  const outlineColor = declarations.get("outline-color");
  if (outlineColor === "var(--color-hypertasks-purple)") {
    let themeColor;
    css.walkDecls("--color-hypertasks-purple", decl => { themeColor = decl.value; });
    assert.equal(themeColor.toLowerCase(), "#4455bb");
  } else {
    assert.equal(outlineColor.toLowerCase(), "#4455bb");
  }
  for (const name of added) {
    assert.ok(!/rounded|border-l-(?:\d|\[\d)|[wh]-|p[trblxy]?-/.test(name), "no selection layout or radius change");
  }
  const bootstrap = postcss.parse(fs.readFileSync(require.resolve("bootstrap/dist/css/bootstrap.css"), "utf8"));
  const shadowSm = [];
  bootstrap.walkDecls("box-shadow", decl => {
    if (decl.parent.selector === ".shadow-sm") shadowSm.push(decl);
  });
  assert.equal(shadowSm.length, 1, "phone shadows replace ring box-shadows, but cannot replace an outline");
  assert.ok(shadowSm[0].important);
  for (const theme of ["porcelain", "graphite", "amoled", "dia", "rounded"]) {
    const sheet = postcss.parse(fs.readFileSync(path.join(root, `src/styles/tailwindThemes/${theme}.css`), "utf8"));
    sheet.walkDecls(/^outline(?:-|$)/, decl => {
      if (decl.parent.selector?.includes(".kanban-task-card")) {
        assert.equal(Boolean(decl.important), false, `${theme} must not override the selected outline`);
      }
    });
  }
  const cardRules = theme => {
    const rules = [];
    postcss.parse(fs.readFileSync(path.join(root, `src/styles/tailwindThemes/${theme}.css`), "utf8"))
      .walkRules(".kanban-task-card", rule => rules.push(rule));
    assert.equal(rules.length, 1, `${theme} must style the kanban card once`);
    return rules[0];
  };
  const rounded = cardRules("rounded");
  assert.equal(rounded.nodes.find(node => node.prop === "border-radius").value, "var(--m3-m)");
  assert.equal(rounded.nodes.find(node => node.prop === "box-shadow").value, "none");
  const dia = cardRules("dia");
  assert.equal(dia.nodes.find(node => node.prop === "border-radius").value, "10px");
  assert.ok(dia.nodes.some(node => node.prop === "box-shadow"));
});

test("the discovered flag is a small default-Everyone bugfix", () => {
  assert.equal(flag.HTPR_7614_SELECTED_CARD_BORDER_FLAG, flagKey);
  assert.equal(flag.default.key, flagKey);
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.ok(flag.default.releaseRisk.reason.trim());
});
