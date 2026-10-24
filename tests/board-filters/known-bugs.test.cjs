const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { cases } = require("./filter-cases.cjs");

test("every board-filter todo or knownBug names an HTPR ticket", () => {
  const ticket = /\bHTPR-\d+\b/;
  for (const entry of cases) {
    if ("knownBug" in entry) assert.match(entry.knownBug, ticket, entry.name);
  }
  for (const file of fs.readdirSync(__dirname, { recursive: true })) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, file), "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ["todo", "knownBug"].includes(node.name.text)) {
        const value = node.initializer;
        const forwardsKnownBug = file === "filters.test.cjs" && node.name.text === "todo" && value?.getText(source) === "entry.knownBug";
        if (!forwardsKnownBug) {
          assert.ok(value && ts.isStringLiteralLike(value), `${file}: ${node.name.text} must be a literal HTPR ticket reason`);
          assert.match(value.text, ticket, `${file}: ${node.name.text}`);
        }
      }
      if (ts.isCallExpression(node) && (
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "todo") ||
        (ts.isElementAccessExpression(node.expression) && node.expression.argumentExpression.text === "todo")
      )) {
        const reason = node.arguments[0];
        assert.ok(reason && ts.isStringLiteralLike(reason), `${file}: todo() must name an HTPR ticket`);
        assert.match(reason.text, ticket, file);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
