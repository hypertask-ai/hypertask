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

const sourceFile = ts.createSourceFile(
  "NewCommentComponent.tsx",
  commentComposer,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const selfClosingElements = [];
const collectSelfClosingElements = (node) => {
  if (ts.isJsxSelfClosingElement(node)) selfClosingElements.push(node);
  ts.forEachChild(node, collectSelfClosingElements);
};
collectSelfClosingElements(sourceFile);

const elementsNamed = (name) =>
  selfClosingElements.filter(
    (element) => element.tagName.getText(sourceFile) === name,
  );

const attributeNamed = (element, name) =>
  element.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(sourceFile) === name,
  );

test("mobile task detail removes the composer-anchored button rail", () => {
  assert.doesNotMatch(commentComposer, /const ScrollToTop\s*=/);
  assert.doesNotMatch(commentComposer, /const PlaylistArrow\s*=/);
  assert.doesNotMatch(commentComposer, /const GoBackButton\s*=/);
  assert.doesNotMatch(commentComposer, /absolute[^"`]*-top-\[/);
});

test("mobile task detail keeps the shared stack above the comment composer", () => {
  const mobileStacks = elementsNamed("MobileCreateTaskButton");
  assert.equal(mobileStacks.length, 1, "expected one shared mobile stack");
  const mobileStack = mobileStacks[0];

  assert.match(
    commentComposer,
    /_mbl && composerHeight > 0 && \(\s*<MobileCreateTaskButton/,
  );
  const bottomOffset = attributeNamed(mobileStack, "bottomOffset");
  assert.ok(
    bottomOffset?.initializer && ts.isJsxExpression(bottomOffset.initializer),
  );
  assert.equal(
    bottomOffset.initializer.expression?.getText(sourceFile),
    "composerHeight + (viewportGeometry?.bottomInset ?? 0)",
  );

  for (let ancestor = mobileStack.parent; ancestor; ancestor = ancestor.parent) {
    if (!ts.isJsxElement(ancestor)) continue;
    const id = attributeNamed(ancestor.openingElement, "id");
    const isCommentComposer = Boolean(
      id?.initializer &&
        ts.isStringLiteral(id.initializer) &&
        id.initializer.text === "comment",
    );
    assert.equal(
      isCommentComposer,
      false,
      "mobile action stack is nested inside #comment",
    );
  }

  assert.doesNotMatch(commentComposer, /const AskAiButton\s*=/);
  assert.doesNotMatch(commentComposer, /MobileFloatingActionButton/);
  assert.doesNotMatch(commentComposer, /ariaLabel="Ask AI about this task"/);
});
