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

const stringAttributeValue = (element, name) => {
  const attribute = attributeNamed(element, name);
  assert.ok(attribute, `${name} attribute not found`);
  assert.ok(
    attribute.initializer && ts.isStringLiteral(attribute.initializer),
    `${name} must be a string`,
  );
  return attribute.initializer.text;
};

test("mobile task detail removes the composer-anchored button rail", () => {
  assert.doesNotMatch(commentComposer, /const ScrollToTop\s*=/);
  assert.doesNotMatch(commentComposer, /const PlaylistArrow\s*=/);
  assert.doesNotMatch(commentComposer, /const GoBackButton\s*=/);
  assert.doesNotMatch(commentComposer, /absolute[^"`]*-top-\[/);
});

test("mobile task detail keeps Ask AI outside the composer in the shared floating action", () => {
  const askAiButtons = elementsNamed("AskAiButton");
  assert.equal(askAiButtons.length, 1, "expected one AskAiButton render");
  const askAiButton = askAiButtons[0];

  assert.match(
    commentComposer,
    /_mbl && composerHeight > 0 && \(\s*<AskAiButton/,
  );
  const askAiBottomOffset = attributeNamed(askAiButton, "bottomOffset");
  assert.ok(
    askAiBottomOffset?.initializer &&
      ts.isJsxExpression(askAiBottomOffset.initializer),
  );
  assert.equal(
    askAiBottomOffset.initializer.expression?.getText(sourceFile),
    "composerHeight + (viewportGeometry?.bottomInset ?? 0)",
  );

  for (let ancestor = askAiButton.parent; ancestor; ancestor = ancestor.parent) {
    if (!ts.isJsxElement(ancestor)) continue;
    const id = attributeNamed(ancestor.openingElement, "id");
    const isCommentComposer = Boolean(
      id?.initializer &&
        ts.isStringLiteral(id.initializer) &&
        id.initializer.text === "comment",
    );
    assert.equal(isCommentComposer, false, "AskAiButton is nested inside #comment");
  }

  const floatingButtons = elementsNamed("MobileFloatingActionButton");
  assert.equal(floatingButtons.length, 1, "expected one floating action definition");
  const floatingButton = floatingButtons[0];
  let owner = floatingButton.parent;
  while (owner && !ts.isVariableDeclaration(owner)) owner = owner.parent;
  assert.ok(owner && ts.isIdentifier(owner.name));
  assert.equal(owner.name.text, "AskAiButton");

  assert.equal(
    stringAttributeValue(floatingButton, "ariaLabel"),
    "Ask AI about this task",
  );
  assert.equal(attributeNamed(floatingButton, "label"), undefined);
  const floatingBottomOffset = attributeNamed(floatingButton, "bottomOffset");
  assert.ok(
    floatingBottomOffset?.initializer &&
      ts.isJsxExpression(floatingBottomOffset.initializer),
  );
  assert.equal(
    floatingBottomOffset.initializer.expression?.getText(sourceFile),
    "bottomOffset",
  );
  assert.ok(attributeNamed(floatingButton, "icon"), "icon attribute not found");
  const onClick = attributeNamed(floatingButton, "onClick");
  assert.ok(onClick?.initializer && ts.isJsxExpression(onClick.initializer));
  assert.equal(onClick.initializer.expression?.getText(sourceFile), "openAIChatInterface");
});
