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
