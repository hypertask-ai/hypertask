const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const parse = (relativePath, kind) =>
  ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
const propertyName = (property) =>
  ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
    ? property.name.text
    : null;
const objectProperty = (object, name) => {
  const property = object.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) && propertyName(candidate) === name,
  );
  assert.ok(property, `${name} configuration not found`);
  assert.ok(
    ts.isObjectLiteralExpression(property.initializer),
    `${name} must be an object`,
  );
  return property.initializer;
};
const jsxAttribute = (element, name) =>
  element.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  );
const classTokens = (className, target) => {
  assert.equal(typeof className, "string", `${target} class list not found`);
  return new Set(className.split(/\s+/).filter(Boolean));
};

const fontSizeConfig = () => {
  const configFile = parse("tailwind.config.ts", ts.ScriptKind.TS);
  const configDeclaration = configFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((declaration) => declaration.name.getText() === "config");
  assert.ok(
    configDeclaration &&
      configDeclaration.initializer &&
      ts.isObjectLiteralExpression(configDeclaration.initializer),
    "Tailwind config object not found",
  );
  const theme = objectProperty(configDeclaration.initializer, "theme");
  const extend = objectProperty(theme, "extend");
  const fontSize = objectProperty(extend, "fontSize");
  const entries = fontSize.properties.filter(ts.isPropertyAssignment);
  const content = entries.find((property) => propertyName(property) === "content");
  assert.ok(content, "content font size not found");
  assert.ok(ts.isStringLiteral(content.initializer), "content font size must be static");
  return {
    content: content.initializer.text,
    names: new Set(entries.map(propertyName).filter(Boolean)),
  };
};

const defaultFontSizeNames = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);
const fontSizeUtilities = (tokens, configuredNames) =>
  [...tokens].filter((token) => {
    const utility = token.split(":").at(-1).replace(/^!/, "");
    if (!utility.startsWith("text-")) return false;
    const value = utility.slice("text-".length);
    return (
      configuredNames.has(value) ||
      defaultFontSizeNames.has(value) ||
      (value.startsWith("[") && !value.startsWith("[color:"))
    );
  });

const sidebarBoardTabClasses = () => {
  const sourceFile = parse(
    "src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx",
    ts.ScriptKind.TSX,
  );
  let classes;
  const visit = (node) => {
    if (
      ts.isConditionalExpression(node) &&
      ts.isIdentifier(node.condition) &&
      node.condition.text === "appShellRail" &&
      ts.isCallExpression(node.whenTrue) &&
      ts.isIdentifier(node.whenTrue.expression) &&
      node.whenTrue.expression.text === "cn"
    ) {
      const className = node.whenTrue.arguments[0];
      if (className && ts.isStringLiteral(className)) classes = className.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return classes;
};

const inboxSplitTabClasses = () => {
  const sourceFile = parse(
    "src/components/notifications/inboxSplit/SplitTitle.tsx",
    ts.ScriptKind.TSX,
  );
  let classes;
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node)) {
      const onClick = jsxAttribute(node, "onClick");
      const className = jsxAttribute(node, "className");
      if (
        onClick?.initializer &&
        ts.isJsxExpression(onClick.initializer) &&
        ts.isIdentifier(onClick.initializer.expression) &&
        onClick.initializer.expression.text === "onClick" &&
        className?.initializer &&
        ts.isJsxExpression(className.initializer) &&
        ts.isNoSubstitutionTemplateLiteral(className.initializer.expression)
      ) {
        classes = className.initializer.expression.text;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return classes;
};

test("sidebar board names and inbox split tabs use the 14px content token", () => {
  const fontSizes = fontSizeConfig();
  assert.equal(fontSizes.content, "14px");

  const targets = [
    ["sidebar board tab", classTokens(sidebarBoardTabClasses(), "sidebar board tab")],
    ["inbox split tab", classTokens(inboxSplitTabClasses(), "inbox split tab")],
  ];

  for (const [target, tokens] of targets) {
    assert.deepEqual(
      fontSizeUtilities(tokens, fontSizes.names),
      ["text-content"],
      `${target} must use only the content font size`,
    );
  }
});
