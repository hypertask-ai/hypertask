// HTPR-5487: sidebar text must use the existing 14px content token.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const readTsxFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readTsxFiles(entryPath);
    return entry.name.endsWith(".tsx")
      ? [{ path: entryPath, source: fs.readFileSync(entryPath, "utf8") }]
      : [];
  });

const leftSidebar = read("src/components/sidebars/leftSidebar.tsx");
const settingsSidebarFiles = readTsxFiles(
  path.join(root, "src/components/sidebars/RightSidebar"),
);
const tailwindConfig = read("tailwind.config.ts");
const compactSidebarTypographyPatterns = [
  /\btext-(?:xs|micro|meta|dense)\b/,
  /\btext-\[(?:length:)?-?\d+(?:\.\d+)?[a-zA-Z%]+/,
  /\btext-\[(?:length:)?(?:calc|clamp|min|max)\(/,
  /\btext-\[(?:length:)?var\(--[^)]+\)\]/,
  /\btext-\[(?:length:)?--[^\s\]]+\]/,
  /\btext-\((?:length:)?--[^\s)]+\)/,
  /\btext-\[(?:length:)?theme\([^\]]+\)\]/,
  /(?:fontSize|font-size|["']fontSize["']|\[\s*["']fontSize["']\s*\])\s*:/,
];
const hasCompactSidebarTypography = (source) =>
  compactSidebarTypographyPatterns.some((pattern) => pattern.test(source));

const parseSidebarSource = (source) => {
  const sourceFile = ts.createSourceFile(
    "sidebar.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  assert.equal(sourceFile.parseDiagnostics.length, 0, "sidebar source must parse");
  return sourceFile;
};
const parsedSources = new Map();
const parsedSourceFor = (source) => {
  if (!parsedSources.has(source)) parsedSources.set(source, parseSidebarSource(source));
  return parsedSources.get(source);
};

const classNameHelpers = new Set(["cn", "clsx", "classnames", "classNames", "cx"]);
const verifiedDndSpreadProperties = new Set([
  "dropProvided.droppableProps",
  "dragProvided.draggableProps",
  "dragProvided.dragHandleProps",
]);
const dndSpreadTypeSources = [
  read("node_modules/@hello-pangea/dnd/src/view/droppable/droppable-types.ts"),
  read("node_modules/@hello-pangea/dnd/src/view/draggable/draggable-types.ts"),
];
const assertDndSpreadContracts = () =>
  dndSpreadTypeSources.forEach((source) => {
    assert.doesNotMatch(source, /\bclassName\b|\bfontSize\b|\bfont-size\b/);
  });
const unwrapExpression = (node) =>
  node &&
  (ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node))
    ? unwrapExpression(node.expression)
    : node;

// Scan only rendered class/style attributes, then fail closed for computed
// values and non-contract JSX spreads that could hide a compact typography token.
const scanSidebarTypography = (source) => {
  const sourceFile = parsedSourceFor(source);
  const compact = [];
  const unresolved = [];
  const unknown = (node) =>
    unresolved.push(node?.getText(sourceFile) || "unknown sidebar typography");
  const propertyName = (property) => property.name?.getText(sourceFile).replace(/["'`]/g, "") || "";

  const inspectStyle = (node) => {
    node = unwrapExpression(node);
    if (!node) return unknown(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return;
    if (ts.isConditionalExpression(node)) {
      inspectStyle(node.whenTrue);
      inspectStyle(node.whenFalse);
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      node.properties.forEach((property) => {
        if (ts.isSpreadAssignment(property)) unknown(property);
        else if (
          ts.isShorthandPropertyAssignment(property) &&
          property.name.text === "fontSize"
        ) unknown(property);
        else if (ts.isPropertyAssignment(property)) {
          const name = propertyName(property);
          if (name === "fontSize") unknown(property);
          else if (name === "style") inspectStyle(property.initializer);
          else if (property.name && ts.isComputedPropertyName(property.name)) unknown(property);
        }
      });
      return;
    }
    unknown(node);
  };

  const inspectClass = (node, interpolation = false) => {
    node = unwrapExpression(node);
    if (!node) return unknown(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return;
    if (ts.isTemplateExpression(node)) {
      node.templateSpans.forEach((span) => inspectClass(span.expression, true));
      return;
    }
    if (ts.isConditionalExpression(node)) {
      inspectClass(node.whenTrue);
      inspectClass(node.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) inspectClass(node.right);
      else if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.PlusToken
      ) {
        inspectClass(node.left, interpolation);
        inspectClass(node.right, interpolation);
      } else unknown(node);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element) => inspectClass(element, interpolation));
      return;
    }
    if (ts.isCallExpression(node)) {
      const helper = ts.isIdentifier(node.expression) && node.expression.text;
      if (classNameHelpers.has(helper)) node.arguments.forEach((arg) => inspectClass(arg));
      else unknown(node);
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      node.properties.forEach((property) => {
        if (ts.isSpreadAssignment(property)) unknown(property);
        else if (ts.isShorthandPropertyAssignment(property)) {
          if (/^(?:className|classNames|style)$/.test(property.name.text)) unknown(property);
        } else if (ts.isPropertyAssignment(property)) {
          const name = propertyName(property);
          if (/^classNames?$/.test(name)) inspectClass(property.initializer);
          else if (name === "style") inspectStyle(property.initializer);
          else if (property.name && ts.isComputedPropertyName(property.name)) unknown(property);
        }
      });
      return;
    }
    // Identifiers, member reads, and unsupported expressions can be imported
    // class/style values, so interpolation and direct expressions fail closed.
    unknown(node);
  };

  const visit = (node) => {
    if (
      node.kind === ts.SyntaxKind.JsxOpeningElement ||
      node.kind === ts.SyntaxKind.JsxSelfClosingElement
    ) {
      node.attributes.properties.forEach((attribute) => {
        if (
          ts.isJsxAttribute(attribute) &&
          (attribute.name.text === "className" || attribute.name.text === "style")
        ) {
          const attributeText = attribute.getText(sourceFile);
          if (hasCompactSidebarTypography(attributeText)) compact.push(attributeText);
          if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
            if (attribute.name.text === "className") inspectClass(attribute.initializer.expression);
            else inspectStyle(attribute.initializer.expression);
          }
        } else if (ts.isJsxSpreadAttribute(attribute)) {
          const expression = unwrapExpression(attribute.expression);
          if (
            !(
              ts.isPropertyAccessExpression(expression) &&
              verifiedDndSpreadProperties.has(expression.getText(sourceFile))
            )
          ) unknown(attribute);
        }
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { compact, unresolved };
};

const tokensFromText = (text) =>
  new Set(text.replace(/[{}"'`]/g, " ").split(/\s+/).filter(Boolean));
const classNameTokenSetsFor = (node) => {
  if (!node) return [];
  node = unwrapExpression(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [tokensFromText(node.text)];
  }
  if (ts.isConditionalExpression(node)) {
    return [...classNameTokenSetsFor(node.whenTrue), ...classNameTokenSetsFor(node.whenFalse)];
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce(
      (sets, span) =>
        sets.flatMap((tokens) =>
          classNameTokenSetsFor(span.expression).map(
            (branch) => new Set([
              ...tokens,
              ...branch,
              ...tokensFromText(span.literal.text),
            ]),
          ),
        ),
      [tokensFromText(node.head.text)],
    );
  }
  return [tokensFromText(node.getText())];
};

const assertSidebarTextNodesUseContentToken = (sources) => {
  const violations = [];
  const expressionMayRenderText = (node) => {
    if (!node) return false;
    node = unwrapExpression(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
    if (ts.isIdentifier(node)) return node.text !== "children";
    if (
      ts.isCallExpression(node) ||
      ts.isArrayLiteralExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      /<[A-Za-z]/.test(node.getText())
    ) return false;
    if (ts.isPropertyAccessExpression(node) && node.name.text === "placeholder") return false;
    return true;
  };

  sources.forEach((source) => {
    const sourceFile = parsedSourceFor(source);
    const elementHasContentToken = (element) => {
      const attribute = element.openingElement.attributes.properties.find(
        (property) =>
          ts.isJsxAttribute(property) &&
          property.name.text === "className" &&
          property.initializer,
      );
      if (!attribute) return false;
      const expression = ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression
        : attribute.initializer;
      const tokenSets = classNameTokenSetsFor(expression);
      return tokenSets.length > 0 && tokenSets.every((tokens) => tokens.has("text-content"));
    };
    const hasContentAncestor = (node) => {
      while (node) {
        if (ts.isJsxElement(node) && elementHasContentToken(node)) return true;
        node = node.parent;
      }
      return false;
    };
    const visit = (node) => {
      if (ts.isJsxElement(node)) {
        node.children.forEach((child) => {
          const isText =
            (ts.isJsxText(child) && child.getText(sourceFile).trim()) ||
            (ts.isJsxExpression(child) && expressionMayRenderText(child.expression));
          if (isText && !hasContentAncestor(node)) violations.push(child.getText(sourceFile).trim());
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  });
  assert.deepEqual(violations, [], "every scoped sidebar text node must inherit text-content");
};

test("sidebar body elements use the existing 14px content token", () => {
  assertDndSpreadContracts();
  assert.match(tailwindConfig, /["']content["']\s*:\s*["']14px["']/);
  [
    "text-[calc(var(--sidebar-font-size)-1px)]",
    "text-[--sidebar-font-size]",
    "text-(--sidebar-font-size)",
    "text-[var(--sidebar-size)]",
    "text-[length:var(--sidebar-size)]",
    "text-[theme(fontSize.sidebar)]",
    "text-[length:theme(fontSize.sidebar)]",
  ].forEach((value) => assert.equal(hasCompactSidebarTypography(value), true));
  assert.equal(hasCompactSidebarTypography("text-[color:var(--muted)]"), false);

  [
    { path: "src/components/sidebars/leftSidebar.tsx", source: leftSidebar },
    ...settingsSidebarFiles.map(({ path: filePath, source }) => ({
      path: filePath,
      source,
    })),
  ].forEach(({ path: filePath, source }) => {
    const result = scanSidebarTypography(source);
    assert.deepEqual(result.compact, [], `compact sidebar typography: ${path.relative(root, filePath)}`);
    assert.deepEqual(result.unresolved, [], `unresolved sidebar typography: ${path.relative(root, filePath)}`);
  });
  assertSidebarTextNodesUseContentToken([
    leftSidebar,
    ...settingsSidebarFiles.map(({ source }) => source),
  ]);
});
