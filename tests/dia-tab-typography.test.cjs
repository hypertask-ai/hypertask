const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const tabSources = [
  ["src/app/search/SearchComp.tsx", "tab.project"],
  ["src/app/inbox/agent/AgentInbox.tsx", "tab.project"],
  ["src/components/Common/TaskRowComponents/TaskListRow.tsx", "tab.project"],
  ["src/components/notifications/inboxSplit/SplitTitle.tsx", "tab.project"],
  ["src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx", "label"],
];

const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

test("tab labels inherit the UI font instead of Dia heading typography", () => {
  for (const [relativePath, labelExpression] of tabSources) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const sourceFile = ts.createSourceFile(
      relativePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let labelsFound = 0;

    const visit = (node) => {
      if (
        ts.isJsxExpression(node) &&
        node.expression?.getText(sourceFile) === labelExpression
      ) {
        labelsFound += 1;
        let ancestor = node.parent;
        while (ancestor) {
          if (ts.isJsxElement(ancestor)) {
            const tagName = ancestor.openingElement.tagName.getText(sourceFile);
            assert.equal(
              headingTags.has(tagName),
              false,
              `${relativePath} must not render ${labelExpression} inside a heading`,
            );
          }
          ancestor = ancestor.parent;
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    assert.ok(labelsFound > 0, `${relativePath} must render ${labelExpression}`);
  }
});
