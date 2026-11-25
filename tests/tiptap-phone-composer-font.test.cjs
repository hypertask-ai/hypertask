const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const scss = require("postcss-scss");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const composerSelector = ".aiChatInput .editorContainer p";
const phoneQuery = "@media (max-width: 760px)";
const stylesheet = path.join(root, "src", "styles", "tiptap.module.scss");

function parseStylesheet() {
  return scss.parse(readFileSync(stylesheet, "utf8"));
}

function normalise(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rulesFor(ast, selector) {
  const found = [];
  ast.walkRules((rule) => {
    if (normalise(rule.selector) !== selector) return;
    let phone = false;
    for (let node = rule.parent; node; node = node.parent) {
      if (node.type === "atrule" && node.name === "media" && normalise(node.params) === "(max-width: 760px)") phone = true;
    }
    found.push({ rule, phone });
  });
  return found;
}

test("the phone AI chat composer paragraph is only sized on phone widths and resolves to 16px", () => {
  const ast = parseStylesheet();
  const scoped = rulesFor(ast, composerSelector);
  assert.equal(scoped.length, 1, `${composerSelector} must be declared once, inside ${phoneQuery}`);
  assert.equal(scoped[0].phone, true, `${composerSelector} must sit inside ${phoneQuery} so desktop keeps its size`);
  const applied = scoped[0].rule.nodes.filter((node) => node.type === "atrule" && node.name === "apply").map((node) => normalise(node.params));
  assert.deepEqual(applied, ["text-emphasis"], `${composerSelector} must take the text-emphasis token`);
  const { default: config } = loadModule("tailwind.config.ts");
  assert.equal(config.theme.extend.fontSize.emphasis, "16px", "text-emphasis must resolve to 16px");
});
