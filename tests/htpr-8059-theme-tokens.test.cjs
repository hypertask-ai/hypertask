const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { compile } = require("@tailwindcss/node");
const postcss = require("postcss");

const root = path.resolve(__dirname, "..");

test("semantic scrollbar colors reach both native and WebKit scrollbar renderers", async () => {
  const compiler = await compile('@import "tailwindcss"; @config "./tailwind.config.ts";', {
    base: root, onDependency() {},
  });
  const classes = ["menu-scroll", "list-scroll", "onboarding-scroll", "list-scroll-hover"];
  const css = postcss.parse(compiler.build(classes.map(name => `scrollbar-thumb-${name}`)));
  for (const [index, name] of classes.entries()) {
    const token = ["menu-scrollbar-thumb", "list-scrollbar-thumb", "onboarding-scrollbar-thumb", "list-scrollbar-hover"][index];
    const declarations = new Map();
    css.walkRules(`.scrollbar-thumb-${name}`, rule => rule.walkDecls(decl => declarations.set(decl.prop, decl.value)));
    assert.equal(declarations.get("--scrollbar-thumb"), `var(--color-${token})`);
    assert.equal(declarations.get("--tw-scrollbar-thumb"), `var(--color-${token})`);
    assert.equal(declarations.get("scrollbar-color"), "var(--tw-scrollbar-thumb) var(--tw-scrollbar-track)");
  }
});

test("legacy tooltip keeps centered content and its stacking class after interpolation", () => {
  const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
  const load = loader({
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": {},
    "./TooltipPortal": { default: () => null },
    "@/lib/constants/APIRouteConstants": {},
    "@/lib/realtime/client": {},
    "../api/global": {},
  });
  const Tooltip = load("src/components/Common/ReactTooltip.tsx").default;
  const view = mount();
  try {
    view.render(React.createElement(Tooltip, { setPosition: false }, "Tooltip content"));
    const tooltip = view.container.firstElementChild;
    assert.equal(tooltip.textContent, "Tooltip content");
    assert.equal(tooltip.classList.contains("items-center"), true);
    assert.equal(tooltip.classList.contains("z-[9999]"), true);
  } finally { view.close(); }
});
