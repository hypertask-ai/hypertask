const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const commentComposer = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx",
  ),
  "utf8",
);

test("mobile task detail removes the composer-anchored button rail", () => {
  assert.doesNotMatch(commentComposer, /const ScrollToTop\s*=/);
  assert.doesNotMatch(commentComposer, /const PlaylistArrow\s*=/);
  assert.doesNotMatch(commentComposer, /const GoBackButton\s*=/);
  assert.doesNotMatch(commentComposer, /absolute[^"`]*-top-\[/);
});

test("mobile task detail keeps Ask AI outside the composer in the shared floating action", () => {
  const sourceFile = ts.createSourceFile(
    "NewCommentComponent.tsx",
    commentComposer,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let askAiButton;
  const findAskAiButton = (node) => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(sourceFile) === "AskAiButton"
    ) {
      askAiButton = node;
    }
    ts.forEachChild(node, findAskAiButton);
  };
  findAskAiButton(sourceFile);
  assert.ok(askAiButton, "AskAiButton render not found");

  for (let ancestor = askAiButton.parent; ancestor; ancestor = ancestor.parent) {
    if (!ts.isJsxElement(ancestor)) continue;
    const isCommentComposer = ancestor.openingElement.attributes.properties.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === "id" &&
        attribute.initializer &&
        ts.isStringLiteral(attribute.initializer) &&
        attribute.initializer.text === "comment",
    );
    assert.equal(isCommentComposer, false, "AskAiButton is nested inside #comment");
  }

  assert.match(commentComposer, /\{_mbl && <AskAiButton\/>\}/);
  assert.match(commentComposer, /MobileFloatingActionButton/);
  assert.match(commentComposer, /ariaLabel="Ask AI about this task"/);
  assert.match(commentComposer, /label="Ask AI"/);
  assert.match(commentComposer, /onClick=\{openAIChatInterface\}/);
});
