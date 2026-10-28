import { writeFileSync } from "node:fs";
import { posix as pathPosix } from "node:path";
import { typescript, git, parseFlagRegistry, parseDefinitions, unwrapExpr, isBindingWrite, assertAddedFlagReleaseRisks, flagDefinitionPaths, parseFlagFile } from "./feature-flag-registry.mjs";

const EXEMPT_TAGS = new Set(["BUGFIX", "INFRA", "AI CHAT"]);
const CROSS_CHECK_LINE_BUDGET = 150;
const FLAG_KEY_MODULES = new Set(["@/lib/flags", "@/lib/flags/keys"]);
const UI_INCLUDE = [
  /^src\/components\//,
  /^src\/pages\/(?!api\/)/,
  /^src\/app\//,
  /^src\/features\//,
  /^src\/hooks\//,
  /\.(jsx|tsx|css)$/,
];
const UI_EXCLUDE = [
  /^src\/pages\/api\//,
  /^src\/app\/api\//,
  /^src\/app\/(?:.*\/)?route\.[jt]sx?$/,
  /^src\/lib\//,
  /^src\/utils\//,
  /(^|\/)tests?\//,
  /\.(test|spec)\.[jt]sx?$/,
  /\.stories\.[jt]sx?$/,
  /(^|\/)docs\//,
  /\.md$/,
];

function isUiFile(path) {
  return !UI_EXCLUDE.some((pattern) => pattern.test(path)) &&
    UI_INCLUDE.some((pattern) => pattern.test(path));
}

function isServerFile(path) {
  return /^src\/(?:lib\/(?:mcp|mcp-server|api)|app\/api|pages\/api|utils\/controllers)\//.test(path) &&
    /\.[jt]sx?$/.test(path) && !/(^|\/)tests?\//.test(path) &&
    !/\.(test|spec|stories)\.[jt]sx?$/.test(path);
}

function refactorUiLineCounts(baseSha, headSha) {
  const diff = git(["-c", "core.quotePath=false", "diff", "--unified=0", "--no-renames", `${baseSha}...${headSha}`]);
  const normalizeLine = (line) => line.trim().replace(/\s+/g, " ").replace(/[,;]$/, "");
  // Multiset: each removed line can credit only one added line.
  const removed = new Map();
  const added = [];
  let uiFile = false;
  let inHunk = false;
  for (const row of diff.split("\n")) {
    if (row.startsWith("diff --git ")) {
      uiFile = false;
      inHunk = false;
    } else if (!inHunk && row.startsWith("+++ ")) {
      const path = row.slice(4);
      uiFile = isUiFile((path.startsWith('"') ? JSON.parse(path) : path).slice(2));
    } else if (row.startsWith("@@ ")) {
      inHunk = true;
    } else if (inHunk && row.startsWith("-")) {
      const key = normalizeLine(row.slice(1));
      removed.set(key, (removed.get(key) ?? 0) + 1);
    } else if (inHunk && uiFile && row.startsWith("+")) {
      added.push(normalizeLine(row.slice(1)));
    }
  }

  const candidates = added.filter((line) => line !== "" &&
    !/^[\]\)}{(\[<>\/,;:]+$/.test(line) && !/^import\b/.test(line) &&
    !/^export (\{[^}]*\}|\*)( from ["'][^"']+["'])?$/.test(line) &&
    !/^(\/\/|\*|\/\*)/.test(line) && !/^["']use client["']$/.test(line) &&
    !/^[A-Za-z_$][\w$]*$/.test(line));
  const newLines = candidates.filter((line) => {
    const left = removed.get(line) ?? 0;
    if (left === 0) return true;
    removed.set(line, left - 1);
    return false;
  });
  // Pick-key union members are type plumbing, not new UI strings.
  const riskyNew = newLines.filter((line) =>
    (/(^|[\s(={?:&|,])<[A-Za-z]/.test(line) || /["'`]/.test(line)) &&
    !/^\| ["'][\w$]+["']$/.test(line)).length;
  return {
    uiAdded: added.length,
    moved: candidates.length - newLines.length,
    newLines: newLines.length,
    riskyNew,
  };
}

function addedLinesFor(baseSha, headSha, path, includeDeletions = false) {
  const lines = new Set();
  const diff = git(["diff", "--unified=0", "--no-renames", `${baseSha}...${headSha}`, "--", path]);
  for (const row of diff.split("\n")) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let line = start; line < start + (includeDeletions ? Math.max(count, 1) : count); line += 1) lines.add(line);
  }
  return lines;
}

function staticBoolean(node, returnedValue = false) {
  while (typescript.isParenthesizedExpression(node) || typescript.isAsExpression(node) ||
         typescript.isTypeAssertionExpression(node) || typescript.isNonNullExpression(node) ||
         typescript.isSatisfiesExpression(node)) node = node.expression;
  if (node.kind === typescript.SyntaxKind.TrueKeyword) return true;
  if (node.kind === typescript.SyntaxKind.FalseKeyword) return false;
  if (node.kind === typescript.SyntaxKind.NullKeyword) return false;
  if (typescript.isIdentifier(node) && node.text === "undefined") return false;
  if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.length > 0;
  }
  if (returnedValue && (typescript.isObjectLiteralExpression(node) || typescript.isArrayLiteralExpression(node) ||
      typescript.isArrowFunction(node) || typescript.isFunctionExpression(node) ||
      typescript.isClassExpression(node) || typescript.isRegularExpressionLiteral(node) ||
      typescript.isNewExpression(node) || typescript.isJsxElement(node) ||
      typescript.isJsxSelfClosingElement(node) || typescript.isJsxFragment(node))) return true;
  if (returnedValue && typescript.isTemplateExpression(node) &&
      (node.head.text.length > 0 || node.templateSpans.some((span) => span.literal.text.length > 0))) return true;
  if (typescript.isNumericLiteral(node)) return Number(node.text) !== 0;
  if (typescript.isPrefixUnaryExpression(node) && node.operator === typescript.SyntaxKind.ExclamationToken) {
    const operand = staticBoolean(node.operand, returnedValue);
    return operand === null ? null : !operand;
  }
  return null;
}

function isStaticallyUnreachable(node) {
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (typescript.isBinaryExpression(parent) && child === parent.right) {
      const left = staticBoolean(parent.left);
      if ((parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken && left === false) ||
          (parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken && left === true)) return true;
    }
    if (typescript.isConditionalExpression(parent)) {
      const condition = staticBoolean(parent.condition);
      if ((child === parent.whenTrue && condition === false) ||
          (child === parent.whenFalse && condition === true)) return true;
    }
    if (typescript.isIfStatement(parent)) {
      const condition = staticBoolean(parent.expression);
      if ((child === parent.thenStatement && condition === false) ||
          (child === parent.elseStatement && condition === true)) return true;
    }
    if (typescript.isWhileStatement(parent) && child === parent.statement &&
        staticBoolean(parent.expression) === false) return true;
    if (typescript.isForStatement(parent) && child === parent.statement && parent.condition &&
        staticBoolean(parent.condition) === false) return true;
    if (typescript.isBlock(parent)) {
      const statementIndex = parent.statements.findIndex((statement) => statement === child);
      if (statementIndex > 0 && parent.statements.slice(0, statementIndex)
        .some((statement) => typescript.isReturnStatement(statement) || typescript.isThrowStatement(statement))) return true;
    }
  }
  return false;
}

function expressionHasSideEffect(node) {
  if (typescript.isFunctionLike(node)) return false;
  if (typescript.isCallExpression(node) || typescript.isNewExpression(node) ||
      typescript.isAwaitExpression(node) || typescript.isYieldExpression(node) ||
      typescript.isDeleteExpression(node) || typescript.isPostfixUnaryExpression(node)) return true;
  if (typescript.isPrefixUnaryExpression(node) &&
      (node.operator === typescript.SyntaxKind.PlusPlusToken ||
       node.operator === typescript.SyntaxKind.MinusMinusToken)) return true;
  if (typescript.isBinaryExpression(node) &&
      node.operatorToken.kind >= typescript.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= typescript.SyntaxKind.LastAssignment) return true;
  return node.getChildren().some(expressionHasSideEffect);
}

function branchHasBehavior(node, pureReturns = true) {
  if (!node || isStaticallyUnreachable(node) || typescript.isEmptyStatement(node)) return false;
  if (typescript.isBlock(node)) return node.statements.some((statement) => branchHasBehavior(statement, pureReturns));
  if (typescript.isReturnStatement(node)) return pureReturns || Boolean(node.expression && expressionHasSideEffect(node.expression));
  if (typescript.isThrowStatement(node) || typescript.isBreakStatement(node) ||
      typescript.isContinueStatement(node)) return true;
  if (typescript.isExpressionStatement(node)) return expressionHasSideEffect(node.expression);
  if (typescript.isVariableStatement(node)) {
    return node.declarationList.declarations.some((declaration) =>
      declaration.initializer && expressionHasSideEffect(declaration.initializer));
  }
  if (typescript.isIfStatement(node)) {
    return branchHasBehavior(node.thenStatement, pureReturns) || branchHasBehavior(node.elseStatement, pureReturns);
  }
  if (typescript.isForStatement(node) || typescript.isForInStatement(node) ||
      typescript.isForOfStatement(node) || typescript.isWhileStatement(node) ||
      typescript.isDoStatement(node)) return branchHasBehavior(node.statement, pureReturns);
  if (typescript.isJsxElement(node) || typescript.isJsxSelfClosingElement(node) ||
      typescript.isJsxFragment(node)) return true;
  return typescript.isExpression(node) && expressionHasSideEffect(node);
}

function branchesStaticallyEquivalent(left, right) {
  if (!left || !right) return left === right;
  const a = unwrapExpr(left);
  const b = unwrapExpr(right);
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return a.getText() === b.getText();
}

// True when `callee` is React's useCallback: a named import from "react"
// (aliases allowed) or <namespace/default import of "react">.useCallback.
function isReactUseCallback(callee, checker) {
  if (!checker) return false;
  const isReact = (importDeclaration) => Boolean(importDeclaration &&
    typescript.isImportDeclaration(importDeclaration) &&
    typescript.isStringLiteral(importDeclaration.moduleSpecifier) &&
    importDeclaration.moduleSpecifier.text === "react");
  if (typescript.isIdentifier(callee)) {
    const declarations = checker.getSymbolAtLocation(callee)?.declarations ?? [];
    return declarations.length > 0 && declarations.every((declaration) =>
      typescript.isImportSpecifier(declaration) &&
      (declaration.propertyName ?? declaration.name).text === "useCallback" &&
      isReact(declaration.parent.parent.parent));
  }
  if (typescript.isPropertyAccessExpression(callee) && callee.name.text === "useCallback" &&
      typescript.isIdentifier(callee.expression)) {
    const declarations = checker.getSymbolAtLocation(callee.expression)?.declarations ?? [];
    return declarations.length > 0 && declarations.every((declaration) =>
      (typescript.isNamespaceImport(declaration) && isReact(declaration.parent.parent)) ||
      (typescript.isImportClause(declaration) && isReact(declaration.parent)));
  }
  return false;
}

function functionBindingName(fn, checker = null) {
  if (fn.name && typescript.isIdentifier(fn.name)) return fn.name;
  if (typescript.isVariableDeclaration(fn.parent) && typescript.isIdentifier(fn.parent.name) &&
      fn.parent.initializer === fn) {
    return fn.parent.name;
  }
  if (typescript.isPropertyAssignment(fn.parent) && typescript.isIdentifier(fn.parent.name) &&
      fn.parent.initializer === fn) {
    return fn.parent.name;
  }
  // const send = useCallback(() => {...}, [deps]) binds the callback to `send`.
  const call = fn.parent;
  if (typescript.isCallExpression(call) && call.arguments[0] === fn &&
      isReactUseCallback(call.expression, checker) &&
      typescript.isVariableDeclaration(call.parent) && typescript.isIdentifier(call.parent.name) &&
      call.parent.initializer === call) {
    return call.parent.name;
  }
  return null;
}

// True when the JSX holding `node` is consumed: reached through the returned
// expression, an argument of a call, or a const that is itself consumed.
function jsxResultIsConsumed(node, checker, live, seen = new Set(), allowCallArguments = true) {
  // A reference or element on a statically dead path (false && x, if (false)) never renders.
  if (isStaticallyUnreachable(node)) return false;
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    // A consuming use only counts inside a live function on a reachable path.
    if (typescript.isReturnStatement(parent)) return isLiveCallSite(parent, live);
    if (typescript.isArrowFunction(parent)) return child === parent.body && live.has(parent);
    if ((typescript.isCallExpression(parent) || typescript.isNewExpression(parent)) &&
        parent.arguments?.includes(child)) return allowCallArguments && isLiveCallSite(parent, live);
    if (typescript.isVariableDeclaration(parent)) {
      if (parent.initializer !== child || !typescript.isIdentifier(parent.name)) return false;
      const symbol = checker.getSymbolAtLocation(parent.name);
      if (!symbol || seen.has(symbol) ||
          (!allowCallArguments && writtenBindingSymbols(node.getSourceFile(), checker).has(symbol))) return false;
      seen.add(symbol);
      let consumed = false;
      (function find(item) {
        if (consumed) return;
        if (typescript.isIdentifier(item) && item !== parent.name &&
            checker.getSymbolAtLocation(item) === symbol &&
            jsxResultIsConsumed(item, checker, live, seen, allowCallArguments)) {
          consumed = true;
          return;
        }
        typescript.forEachChild(item, find);
      })(node.getSourceFile());
      return consumed;
    }
    if (!allowCallArguments && typescript.isBinaryExpression(parent) &&
        !((child === parent.right && (parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ||
             parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken)) ||
          (child === parent.left && parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken))) return false;
    if (!allowCallArguments && ((typescript.isConditionalExpression(parent) && child === parent.condition) ||
        typescript.isJsxAttribute(parent))) return false;
    if (typescript.isParenthesizedExpression(parent) || typescript.isAsExpression(parent) ||
        typescript.isNonNullExpression(parent) || typescript.isSatisfiesExpression(parent) ||
        typescript.isTypeAssertionExpression(parent) || typescript.isConditionalExpression(parent) ||
        typescript.isBinaryExpression(parent) || typescript.isJsxExpression(parent) ||
        typescript.isJsxElement(parent) || typescript.isJsxFragment(parent) ||
        typescript.isJsxAttribute(parent) || typescript.isJsxAttributes(parent) ||
        typescript.isJsxOpeningElement(parent) || typescript.isJsxSelfClosingElement(parent) ||
        typescript.isArrayLiteralExpression(parent) || typescript.isSpreadElement(parent)) continue;
    return false;
  }
  return false;
}

function isJsxCallbackValue(node, checker, live) {
  let child = node;
  while (child.parent && typescript.isParenthesizedExpression(child.parent)) child = child.parent;
  if (!child.parent || !typescript.isJsxExpression(child.parent)) return false;
  const container = child.parent.parent;
  const customChild = typescript.isJsxElement(container) &&
    (typescript.isPropertyAccessExpression(container.openingElement.tagName) ||
     (typescript.isIdentifier(container.openingElement.tagName) &&
      /^[A-Z]/.test(container.openingElement.tagName.text)));
  return (typescript.isJsxAttribute(container) || customChild) &&
    jsxResultIsConsumed(child, checker, live);
}

function isExportedVariableStatement(statement) {
  return Boolean(statement?.modifiers?.some((modifier) =>
    modifier.kind === typescript.SyntaxKind.ExportKeyword ||
    modifier.kind === typescript.SyntaxKind.DefaultKeyword));
}

function isExportedFunctionLike(fn) {
  if (fn.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword ||
      modifier.kind === typescript.SyntaxKind.DefaultKeyword)) {
    return true;
  }
  if (typescript.isExportAssignment(fn.parent)) return true;
  if (typescript.isVariableDeclaration(fn.parent) && fn.parent.initializer === fn &&
      typescript.isVariableDeclarationList(fn.parent.parent) &&
      typescript.isVariableStatement(fn.parent.parent.parent)) {
    return isExportedVariableStatement(fn.parent.parent.parent);
  }
  if (typescript.isPropertyAssignment(fn.parent) && fn.parent.initializer === fn &&
      typescript.isObjectLiteralExpression(fn.parent.parent) &&
      typescript.isVariableDeclaration(fn.parent.parent.parent) &&
      typescript.isVariableDeclarationList(fn.parent.parent.parent.parent) &&
      typescript.isVariableStatement(fn.parent.parent.parent.parent.parent)) {
    return isExportedVariableStatement(fn.parent.parent.parent.parent.parent);
  }
  return false;
}

function unwrapArgumentExpression(node) {
  let current = node;
  while (current && (typescript.isParenthesizedExpression(current) ||
         typescript.isAsExpression(current) || typescript.isTypeAssertionExpression(current) ||
         typescript.isNonNullExpression(current) || typescript.isSatisfiesExpression(current))) {
    current = current.expression;
  }
  return current;
}

function isExportedThroughCallWrapper(fn) {
  let argument = fn;
  while (argument.parent && (
    (typescript.isParenthesizedExpression(argument.parent) && argument.parent.expression === argument) ||
    (typescript.isAsExpression(argument.parent) && argument.parent.expression === argument) ||
    (typescript.isTypeAssertionExpression(argument.parent) && argument.parent.expression === argument) ||
    (typescript.isNonNullExpression(argument.parent) && argument.parent.expression === argument) ||
    (typescript.isSatisfiesExpression(argument.parent) && argument.parent.expression === argument)
  )) {
    argument = argument.parent;
  }
  if (!typescript.isCallExpression(argument.parent)) return false;
  if (!argument.parent.arguments.some((arg) => unwrapArgumentExpression(arg) === fn)) return false;

  let expression = argument.parent;
  for (;;) {
    let nested = expression;
    while (nested.parent && (
      (typescript.isParenthesizedExpression(nested.parent) && nested.parent.expression === nested) ||
      (typescript.isAsExpression(nested.parent) && nested.parent.expression === nested) ||
      (typescript.isTypeAssertionExpression(nested.parent) && nested.parent.expression === nested) ||
      (typescript.isNonNullExpression(nested.parent) && nested.parent.expression === nested) ||
      (typescript.isSatisfiesExpression(nested.parent) && nested.parent.expression === nested)
    )) {
      nested = nested.parent;
    }

    if (typescript.isExportAssignment(nested.parent)) return true;
    if (typescript.isVariableDeclaration(nested.parent) && nested.parent.initializer === nested &&
        typescript.isVariableDeclarationList(nested.parent.parent) &&
        typescript.isVariableStatement(nested.parent.parent.parent)) {
      return isExportedVariableStatement(nested.parent.parent.parent);
    }

    if (!typescript.isCallExpression(nested.parent)) return false;
    if (!nested.parent.arguments.some((arg) => unwrapArgumentExpression(arg) === expression || arg === nested)) {
      return false;
    }
    expression = nested.parent;
  }
}

function writtenBindingSymbols(sourceFile, checker) {
  const written = new Set();
  function visit(node) {
    if (typescript.isIdentifier(node)) {
      let target = node;
      while (target.parent && (
        ((typescript.isParenthesizedExpression(target.parent) ||
          typescript.isAsExpression(target.parent) || typescript.isTypeAssertionExpression(target.parent) ||
          typescript.isNonNullExpression(target.parent) || typescript.isSatisfiesExpression(target.parent) ||
          typescript.isSpreadElement(target.parent)) && target.parent.expression === target)
      )) target = target.parent;
      const parent = target.parent;
      const loopWrite = parent && (typescript.isForOfStatement(parent) || typescript.isForInStatement(parent)) &&
        parent.initializer === target;
      if (isBindingWrite(target) || loopWrite) {
        const symbol = typescript.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
        if (symbol) written.add(symbol);
      }
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  return written;
}

function identifierDefaultExportFunctions(sourceFile, checker) {
  const exported = new Set();
  for (const statement of sourceFile.statements) {
    if (!typescript.isExportAssignment(statement) || statement.isExportEquals) continue;
    const expression = unwrapArgumentExpression(statement.expression);
    if (!typescript.isIdentifier(expression)) continue;
    const symbol = checker.getSymbolAtLocation(expression);
    for (const declaration of symbol?.declarations ?? []) {
      if (typescript.isFunctionDeclaration(declaration)) exported.add(declaration);
      else if (typescript.isVariableDeclaration(declaration) && declaration.initializer) {
        const initializer = unwrapArgumentExpression(declaration.initializer);
        if (typescript.isFunctionLike(initializer)) exported.add(initializer);
      }
    }
  }
  return exported;
}

function isExportedUiEntry(fn, identifierExports = new Set()) {
  return identifierExports.has(fn) || isExportedFunctionLike(fn) || isExportedThroughCallWrapper(fn);
}

function enclosingFunctionLike(node) {
  let current = node.parent;
  while (current && !typescript.isSourceFile(current)) {
    if (typescript.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

function isLiveCallSite(node, live, allowModuleScope = true) {
  if (isStaticallyUnreachable(node)) return false;
  const enclosing = enclosingFunctionLike(node);
  return enclosing ? live.has(enclosing) : allowModuleScope;
}

function branchIsNullishOrEmpty(node, renderOnly = false) {
  if (!node) return true;
  if (typescript.isBlock(node)) {
    if (node.statements.length === 0) return true;
    if (node.statements.length === 1) return branchIsNullishOrEmpty(node.statements[0], renderOnly);
    return false;
  }
  if (typescript.isReturnStatement(node)) return branchIsNullishOrEmpty(node.expression, renderOnly);
  const expression = unwrapExpr(node);
  if (!expression) return true;
  if (expression.kind === typescript.SyntaxKind.NullKeyword ||
      expression.kind === typescript.SyntaxKind.UndefinedKeyword ||
      expression.kind === typescript.SyntaxKind.FalseKeyword ||
      (renderOnly && expression.kind === typescript.SyntaxKind.TrueKeyword)) {
    return true;
  }
  if (typescript.isIdentifier(expression) && expression.text === "undefined") return true;
  if (typescript.isStringLiteral(expression) && expression.text === "") return true;
  if (typescript.isJsxExpression(expression)) return branchIsNullishOrEmpty(expression.expression, renderOnly);
  if (renderOnly && (typescript.isOmittedExpression(expression) || typescript.isVoidExpression(expression) ||
      (typescript.isPrefixUnaryExpression(expression) && expression.operator === typescript.SyntaxKind.ExclamationToken) ||
      (typescript.isBinaryExpression(expression) &&
       ((expression.operatorToken.kind >= typescript.SyntaxKind.LessThanToken &&
         expression.operatorToken.kind <= typescript.SyntaxKind.ExclamationEqualsEqualsToken) ||
        expression.operatorToken.kind === typescript.SyntaxKind.InKeyword ||
        expression.operatorToken.kind === typescript.SyntaxKind.InstanceOfKeyword)))) return true;
  if (renderOnly && typescript.isConditionalExpression(expression)) {
    const condition = staticBoolean(expression.condition, true);
    if (condition !== null) return branchIsNullishOrEmpty(condition ? expression.whenTrue : expression.whenFalse, true);
    return branchIsNullishOrEmpty(expression.whenTrue, true) && branchIsNullishOrEmpty(expression.whenFalse, true);
  }
  if (renderOnly && typescript.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ||
       expression.operatorToken.kind === typescript.SyntaxKind.BarBarToken)) {
    const left = staticBoolean(expression.left, true);
    if (left !== null) {
      const returnsLeft = expression.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ? !left : left;
      return branchIsNullishOrEmpty(returnsLeft ? expression.left : expression.right, true);
    }
    return branchIsNullishOrEmpty(expression.left, true) && branchIsNullishOrEmpty(expression.right, true);
  }
  if (renderOnly && typescript.isSpreadElement(expression)) {
    const operand = unwrapExpr(expression.expression);
    return (!typescript.isArrayLiteralExpression(operand) && !typescript.isStringLiteral(operand)) ||
      branchIsNullishOrEmpty(operand, true);
  }
  if (renderOnly && typescript.isArrayLiteralExpression(expression)) {
    return expression.elements.every((element) => branchIsNullishOrEmpty(element, true));
  }
  if (typescript.isJsxFragment(expression)) {
    return expression.children.every((child) =>
      typescript.isJsxText(child) ? child.getText().trim() === "" : branchIsNullishOrEmpty(child, renderOnly));
  }
  return false;
}

function normalizedCondition(node) {
  return unwrapExpr(node).getText().replace(/\s+/g, " ").trim().replace(/;$/, "").trim();
}

function conditionTerm(node) {
  const expression = unwrapExpr(node);
  return typescript.isPrefixUnaryExpression(expression) && expression.operator === typescript.SyntaxKind.ExclamationToken
    ? `!(${normalizedCondition(expression.operand)})`
    : normalizedCondition(expression);
}

function negatedConditionTerm(node) {
  const expression = unwrapExpr(node);
  return typescript.isPrefixUnaryExpression(expression) && expression.operator === typescript.SyntaxKind.ExclamationToken
    ? normalizedCondition(expression.operand)
    : `!(${normalizedCondition(expression)})`;
}

function addTagCounts(target, source, combine) {
  for (const [tag, count] of source) target.set(tag, combine(target.get(tag) ?? 0, count));
  return target;
}

function renderedTagCounts(node) {
  if (!node) return new Map();
  if (typescript.isConditionalExpression(node)) {
    return addTagCounts(renderedTagCounts(node.condition),
      addTagCounts(renderedTagCounts(node.whenTrue), renderedTagCounts(node.whenFalse), Math.max), (a, b) => a + b);
  }
  if (typescript.isIfStatement(node)) {
    return addTagCounts(renderedTagCounts(node.expression),
      addTagCounts(renderedTagCounts(node.thenStatement), renderedTagCounts(node.elseStatement), Math.max), (a, b) => a + b);
  }
  const counts = new Map();
  if (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText();
    if (/^[A-Z]/.test(tag) || typescript.isPropertyAccessExpression(node.tagName)) counts.set(tag, 1);
  }
  typescript.forEachChild(node, (child) => { addTagCounts(counts, renderedTagCounts(child), (a, b) => a + b); });
  return counts;
}

function exposureSnapshot(ref, path, mergeBase) {
  let source = "";
  try { source = git(["cat-file", "blob", `${ref}:${path}`]); } catch {}
  const scriptKind = path.endsWith(".tsx") ? typescript.ScriptKind.TSX :
    path.endsWith(".jsx") ? typescript.ScriptKind.JSX :
    path.endsWith(".ts") ? typescript.ScriptKind.TS : typescript.ScriptKind.JS;
  const file = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true, scriptKind);
  if (file.parseDiagnostics.length) throw new Error(`invalid ${path}: ${file.parseDiagnostics[0].messageText}`);
  const occurrences = [];
  const names = new Set();
  const functions = new Map();
  const existingImports = new Set();
  for (const statement of file.statements) {
    if (!typescript.isImportDeclaration(statement) || !typescript.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (!moduleName.startsWith("@/") && !moduleName.startsWith(".")) continue;
    const base = moduleName.startsWith("@/") ? `src/${moduleName.slice(2)}` :
      pathPosix.normalize(pathPosix.join(pathPosix.dirname(path), moduleName));
    const candidates = /\.[jt]sx?$/.test(base) ? [base] : [
      `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`,
      `${base}/index.tsx`, `${base}/index.ts`, `${base}/index.jsx`, `${base}/index.js`,
    ];
    if (!candidates.some((candidate) => {
      try { git(["cat-file", "-e", `${mergeBase}:${candidate}`]); return true; } catch { return false; }
    })) continue;
    const clause = statement.importClause;
    if (clause?.name) existingImports.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && typescript.isNamedImports(bindings)) {
      for (const element of bindings.elements) existingImports.add(element.name.text);
    } else if (bindings && typescript.isNamespaceImport(bindings)) {
      existingImports.add(bindings.name.text);
    }
  }
  function conjuncts(node, guards) {
    const expression = unwrapExpr(node);
    if (typescript.isBinaryExpression(expression) &&
        expression.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken) {
      conjuncts(expression.left, guards);
      conjuncts(expression.right, guards);
    } else {
      guards.add(normalizedCondition(expression));
    }
  }
  function disjuncts(node, terms = new Set()) {
    const expression = unwrapExpr(node);
    if (typescript.isBinaryExpression(expression) &&
        expression.operatorToken.kind === typescript.SyntaxKind.BarBarToken) {
      disjuncts(expression.left, terms);
      disjuncts(expression.right, terms);
    } else {
      terms.add(conditionTerm(expression));
    }
    return terms;
  }
  function hiddenUnless(node, terms = new Set()) {
    const expression = unwrapExpr(node);
    if (typescript.isBinaryExpression(expression) &&
        expression.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken) {
      hiddenUnless(expression.left, terms);
      hiddenUnless(expression.right, terms);
    } else {
      terms.add(negatedConditionTerm(expression));
    }
    return terms;
  }
  function visit(node) {
    if (typescript.isIdentifier(node) || typescript.isPropertyAccessExpression(node)) names.add(node.getText());
    if (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      if (/^[A-Z]/.test(tag) || typescript.isPropertyAccessExpression(node.tagName)) {
        const guards = new Set();
        let child = node;
        for (let parent = node.parent; parent && !typescript.isFunctionLike(parent); child = parent, parent = parent.parent) {
          if (typescript.isBinaryExpression(parent) && child === parent.right &&
              parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken) conjuncts(parent.left, guards);
          if (typescript.isConditionalExpression(parent)) {
            if (child === parent.whenTrue) guards.add(normalizedCondition(parent.condition));
            if (child === parent.whenFalse) guards.add(`!(${normalizedCondition(parent.condition)})`);
          }
          if (typescript.isIfStatement(parent)) {
            if (child === parent.thenStatement) guards.add(normalizedCondition(parent.expression));
            if (child === parent.elseStatement) guards.add(`!(${normalizedCondition(parent.expression)})`);
          }
        }
        occurrences.push({ tag, guards });
      }
    }
    if (typescript.isFunctionLike(node)) {
      const name = functionBindingName(node)?.text;
      if (name) {
        const returns = [];
        function earlyReturns(child) {
          if (child !== node && typescript.isFunctionLike(child)) return;
          if (typescript.isIfStatement(child)) {
            let branch = child.thenStatement;
            if (typescript.isBlock(branch) && branch.statements.length === 1) branch = branch.statements[0];
            if (typescript.isReturnStatement(branch) && branchIsNullishOrEmpty(branch)) {
              returns.push(disjuncts(child.expression));
            } else if (typescript.isReturnStatement(branch)) {
              const next = child.elseStatement ?? (typescript.isBlock(child.parent)
                ? child.parent.statements[child.parent.statements.indexOf(child) + 1] : null);
              if (next && branchIsNullishOrEmpty(next) &&
                  (typescript.isReturnStatement(next) || typescript.isBlock(next))) {
                returns.push(hiddenUnless(child.expression));
              }
            }
          }
          const arrowBody = typescript.isArrowFunction(node) && child === node.body;
          const returned = typescript.isReturnStatement(child) && child.expression ? unwrapExpr(child.expression)
            : arrowBody ? unwrapExpr(child) : null;
          if (returned && typescript.isConditionalExpression(returned)) {
            if (branchIsNullishOrEmpty(returned.whenTrue)) returns.push(disjuncts(returned.condition));
            else if (branchIsNullishOrEmpty(returned.whenFalse)) returns.push(hiddenUnless(returned.condition));
          } else if (returned && typescript.isBinaryExpression(returned) &&
              returned.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken) {
            returns.push(hiddenUnless(returned.left));
          }
          typescript.forEachChild(child, earlyReturns);
        }
        earlyReturns(node);
        functions.set(name, { returns, jsx: functionContainsJsx(node) });
      }
    }
    typescript.forEachChild(node, visit);
  }
  visit(file);
  return { occurrences, names, functions, existingImports, counts: renderedTagCounts(file) };
}

function widenedUiExposure(mergeBase, headSha, uiFiles) {
  const files = uiFiles.filter((path) => /\.[jt]sx?$/.test(path)).map((path) => ({
    path,
    base: exposureSnapshot(mergeBase, path, mergeBase),
    head: exposureSnapshot(headSha, path, mergeBase),
  }));
  const baseNames = new Set(files.flatMap(({ base }) => [...base.names]));
  const baseCounts = new Map();
  const headCounts = new Map();
  for (const { base, head } of files) {
    addTagCounts(baseCounts, base.counts, (a, b) => a + b);
    addTagCounts(headCounts, head.counts, (a, b) => a + b);
  }
  for (const { path, base, head } of files) {
    const remaining = [...base.occurrences];
    for (const [index, first] of base.occurrences.entries()) {
      for (const second of base.occurrences.slice(index + 1)) {
        if (first.tag !== second.tag || first.guards.size !== second.guards.size) continue;
        const onlyFirst = [...first.guards].filter((guard) => !second.guards.has(guard));
        const onlySecond = [...second.guards].filter((guard) => !first.guards.has(guard));
        if (onlyFirst.length === 1 && onlySecond.length === 1 &&
            (onlySecond[0] === `!(${onlyFirst[0]})` || onlyFirst[0] === `!(${onlySecond[0]})`)) {
          remaining.push({ tag: first.tag, guards: new Set([...first.guards].filter((guard) => second.guards.has(guard))) });
        }
      }
    }
    const added = head.occurrences.filter(({ tag, guards }) => {
      const index = remaining.findIndex((old) => old.tag === tag && old.guards.size === guards.size &&
        [...guards].every((guard) => old.guards.has(guard)));
      if (index === -1) return true;
      remaining.splice(index, 1);
      return false;
    });
    for (const { tag, guards } of added) {
      if (remaining.some((old) => old.tag === tag && old.guards.size > guards.size &&
          [...guards].every((guard) => old.guards.has(guard)))) return `${path}:${tag} condition removed`;
    }
    for (const [name, fn] of base.functions) {
      const next = head.functions.get(name);
      const keptOrBroadened = (terms) => next.returns.some((nextTerms) => [...terms].every((term) => nextTerms.has(term)));
      if (fn.jsx && next && fn.returns.some((terms) => !keptOrBroadened(terms))) {
        return `${path}:${name} early return removed`;
      }
    }
  }
  for (const { path, head } of files) {
    for (const { tag } of head.occurrences) {
      const extra = headCounts.get(tag) - (baseCounts.get(tag) ?? 0);
      if (extra > 0 && (baseNames.has(tag) || head.existingImports.has(tag.split(".")[0]))) {
        return `${path}:${tag} rendered ${extra} more times`;
      }
    }
  }
  return null;
}

function collectLiveFunctions(sourceFile, checker, entries = null, renderOnly = false) {
  const functions = [];
  function collect(node) {
    if (typescript.isFunctionLike(node)) functions.push(node);
    typescript.forEachChild(node, collect);
  }
  collect(sourceFile);

  // Exported functions are live seeds (importers may render them). An unused
  // exported helper with a gate cannot cover a sibling exported JSX entry:
  // see hasUngatedExportedJsxEntry below.
  const identifierExports = identifierDefaultExportFunctions(sourceFile, checker);
  const writtenSymbols = writtenBindingSymbols(sourceFile, checker);
  const reboundFunctions = new Set(functions.filter((fn) => {
    const name = functionBindingName(fn, checker);
    return name && writtenSymbols.has(checker.getSymbolAtLocation(name));
  }));
  // Export recognition remains intact for the ungated-sibling check, but a
  // rebound binding cannot prove which implementation runs. No flow analysis.
  const live = new Set(functions.filter((fn) => !reboundFunctions.has(fn) &&
    (!renderOnly || functionContainsJsx(fn) || /^[A-Z]/.test(functionBindingName(fn, checker)?.text ?? "")) &&
    (entries ? entries.has(fn) : isExportedUiEntry(fn, identifierExports))));
  const functionBySymbol = new Map();
  for (const fn of functions) {
    const name = functionBindingName(fn, checker);
    const symbol = name && checker.getSymbolAtLocation(name);
    if (symbol && !writtenSymbols.has(symbol)) functionBySymbol.set(symbol, fn);
  }
  let changed = true;
  while (changed) {
    changed = false;
    // Returning a named callback from a live hook exposes that callback to its
    // callers. Resolve property values by symbol, never by matching their text.
    for (const fn of renderOnly ? [] : Array.from(live)) {
      function returned(node) {
        if (node !== fn && typescript.isFunctionLike(node)) return;
        if (isStaticallyUnreachable(node)) return;
        if (typescript.isReturnStatement(node) && node.expression) {
          const expression = unwrapArgumentExpression(node.expression);
          if (typescript.isObjectLiteralExpression(expression)) {
            const names = new Set();
            const unambiguous = expression.properties.every((property) => {
              if (!typescript.isShorthandPropertyAssignment(property) &&
                  !typescript.isPropertyAssignment(property)) return false;
              const name = property.name;
              if (!typescript.isIdentifier(name) && !typescript.isStringLiteral(name) &&
                  !typescript.isNumericLiteral(name)) return false;
              if (names.has(name.text)) return false;
              names.add(name.text);
              return true;
            });
            if (!unambiguous) return;
            for (const property of expression.properties) {
              let symbol;
              if (typescript.isShorthandPropertyAssignment(property)) {
                symbol = checker.getShorthandAssignmentValueSymbol(property);
              } else if (typescript.isPropertyAssignment(property)) {
                const value = unwrapArgumentExpression(property.initializer);
                if (typescript.isIdentifier(value)) symbol = checker.getSymbolAtLocation(value);
              }
              const callback = symbol && functionBySymbol.get(symbol);
              if (callback && !live.has(callback)) { live.add(callback); changed = true; }
            }
          }
        }
        typescript.forEachChild(node, returned);
      }
      returned(fn);
    }
    // An inline callback in a JSX attribute (onClick={() => send()}) runs when
    // the live element it sits in is rendered.
    for (const fn of functions) {
      if (renderOnly || live.has(fn) || !isJsxCallbackValue(fn, checker, live) || !isLiveCallSite(fn, live, !entries)) continue;
      live.add(fn);
      changed = true;
    }
    for (const fn of functions) {
      if (live.has(fn) || fn.asteriskToken || !typescript.isCallExpression(fn.parent) ||
          fn.parent.arguments.length !== 1 || fn.parent.arguments[0] !== fn ||
          !typescript.isIdentifier(fn.parent.expression)) continue;
      const call = fn.parent;
      const binding = checker.getSymbolAtLocation(call.expression)?.declarations?.[0];
      if (!binding || !typescript.isImportSpecifier(binding) ||
          (binding.propertyName ?? binding.name).text !== "wrapMcpRoute") continue;
      const declaration = binding.parent.parent.parent;
      if (!typescript.isImportDeclaration(declaration) ||
          declaration.moduleSpecifier.text !== "@/lib/mcp/routeWrapper" ||
          !typescript.isCallExpression(call.parent) || call.parent.expression !== call ||
          !isLiveCallSite(call.parent, live, !entries)) continue;
      live.add(fn);
      changed = true;
    }
    for (const fn of functions) {
      if (live.has(fn) || reboundFunctions.has(fn)) continue;
      const name = functionBindingName(fn, checker);
      if (!name) continue;
      const symbol = checker.getSymbolAtLocation(name);
      if (!symbol) continue;
      let referenced = false;
      function visit(node) {
        if (referenced || node === fn) return;
        if (isStaticallyUnreachable(node)) return;
        if (!renderOnly && typescript.isCallExpression(node) && typescript.isIdentifier(node.expression) &&
            checker.getSymbolAtLocation(node.expression) === symbol &&
            isLiveCallSite(node, live, !entries)) {
          referenced = true;
          return;
        }
        if (!renderOnly && typescript.isIdentifier(node) && isJsxCallbackValue(node, checker, live) &&
            checker.getSymbolAtLocation(node) === symbol && isLiveCallSite(node, live, !entries)) {
          referenced = true;
          return;
        }
        if ((typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) &&
            typescript.isIdentifier(node.tagName) &&
            checker.getSymbolAtLocation(node.tagName) === symbol &&
            isLiveCallSite(node, live, !entries) && jsxResultIsConsumed(node, checker, live, new Set(), !renderOnly)) {
          referenced = true;
          return;
        }
        typescript.forEachChild(node, visit);
      }
      visit(sourceFile);
      if (referenced) {
        live.add(fn);
        changed = true;
      }
    }
  }
  return live;
}

function callEnclosingFunctionIsLive(call, sourceFile, checker, liveFunctions = null) {
  const live = liveFunctions ?? collectLiveFunctions(sourceFile, checker);
  const enclosing = enclosingFunctionLike(call);
  if (!enclosing) return true;
  return live.has(enclosing);
}

function expressionResultIsObserved(node) {
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (typescript.isReturnStatement(parent) || typescript.isJsxExpression(parent) ||
        typescript.isSpreadAssignment(parent) ||
        (typescript.isArrowFunction(parent) && child === parent.body) ||
        ((typescript.isCallExpression(parent) || typescript.isNewExpression(parent)) &&
         parent.arguments?.includes(child))) return true;
    if (typescript.isBinaryExpression(parent) &&
        parent.operatorToken.kind === typescript.SyntaxKind.CommaToken) return false;
    if (typescript.isParenthesizedExpression(parent) || typescript.isAsExpression(parent) ||
        typescript.isTypeAssertionExpression(parent) || typescript.isNonNullExpression(parent) ||
        typescript.isSatisfiesExpression(parent) || typescript.isBinaryExpression(parent) ||
        typescript.isConditionalExpression(parent) || typescript.isTemplateSpan(parent) ||
        typescript.isTemplateExpression(parent)) continue;
    return false;
  }
  return false;
}

function controlsRuntimeBranch(node, pureReturns = true) {
  if (isStaticallyUnreachable(node)) return false;
  const hasBehavior = (branch) => branchHasBehavior(branch, pureReturns);
  let controlsOutput = false;
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (typescript.isBinaryExpression(parent) && child === parent.left &&
        (parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ||
         parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken)) {
      const right = staticBoolean(parent.right);
      if ((parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken && right === false) ||
          (parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken && right === true)) return false;
      controlsOutput = hasBehavior(parent.right) || (pureReturns && expressionResultIsObserved(parent));
      continue;
    }
    if (typescript.isConditionalExpression(parent) && child === parent.condition) {
      if (branchesStaticallyEquivalent(parent.whenTrue, parent.whenFalse) ||
          (branchIsNullishOrEmpty(parent.whenTrue) && branchIsNullishOrEmpty(parent.whenFalse))) {
        controlsOutput = false;
      } else {
        controlsOutput = (hasBehavior(parent.whenTrue) || hasBehavior(parent.whenFalse) ||
          (pureReturns && expressionResultIsObserved(parent)));
      }
      continue;
    }
    if (typescript.isIfStatement(parent) && child === parent.expression) {
      if ((parent.elseStatement &&
           branchesStaticallyEquivalent(parent.thenStatement, parent.elseStatement)) ||
          (branchIsNullishOrEmpty(parent.thenStatement) &&
           branchIsNullishOrEmpty(parent.elseStatement))) {
        controlsOutput = false;
      } else {
        controlsOutput = hasBehavior(parent.thenStatement) || hasBehavior(parent.elseStatement);
      }
      let branch = parent.thenStatement;
      if (typescript.isBlock(branch) && branch.statements.length === 1) branch = branch.statements[0];
      if (!pureReturns && !parent.elseStatement && typescript.isReturnStatement(branch) &&
          typescript.isBlock(parent.parent)) {
        const following = parent.parent.statements.slice(parent.parent.statements.indexOf(parent) + 1);
        controlsOutput ||= following.some(hasBehavior);
      }
      continue;
    }
    if ((typescript.isWhileStatement(parent) && child === parent.expression) ||
        (typescript.isDoStatement(parent) && child === parent.expression) ||
        (typescript.isForStatement(parent) && child === parent.condition)) {
      controlsOutput = hasBehavior(parent.statement);
      continue;
    }
    if (typescript.isParenthesizedExpression(parent) || typescript.isAsExpression(parent) ||
        typescript.isTypeAssertionExpression(parent) || typescript.isNonNullExpression(parent) ||
        typescript.isSatisfiesExpression(parent) || typescript.isAwaitExpression(parent) ||
        (typescript.isPrefixUnaryExpression(parent) &&
         parent.operator === typescript.SyntaxKind.ExclamationToken)) continue;
    if (typescript.isBinaryExpression(parent)) {
      if (parent.operatorToken.kind === typescript.SyntaxKind.CommaToken) return false;
      if (parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ||
          parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken) {
        if (child === parent.right) controlsOutput ||= (pureReturns && expressionResultIsObserved(parent));
        continue;
      }
      const other = child === parent.left ? parent.right : parent.left;
      if ((parent.operatorToken.kind === typescript.SyntaxKind.EqualsEqualsToken ||
           parent.operatorToken.kind === typescript.SyntaxKind.EqualsEqualsEqualsToken ||
           parent.operatorToken.kind === typescript.SyntaxKind.ExclamationEqualsToken ||
           parent.operatorToken.kind === typescript.SyntaxKind.ExclamationEqualsEqualsToken) &&
          staticBoolean(other) !== null) continue;
      return false;
    }
    if (typescript.isJsxExpression(parent) || typescript.isSpreadAssignment(parent)) return controlsOutput;
    if (typescript.isConditionalExpression(parent) || typescript.isTemplateSpan(parent) ||
        typescript.isTemplateExpression(parent)) {
      if (controlsOutput) continue;
      return false;
    }
    if ((typescript.isCallExpression(parent) || typescript.isNewExpression(parent)) &&
        parent.arguments?.includes(child)) return controlsOutput;
    if (typescript.isBlock(parent)) continue;
    if (typescript.isStatement(parent) || typescript.isVariableDeclaration(parent) ||
        typescript.isFunctionLike(parent)) return controlsOutput;
    return false;
  }
  return controlsOutput;
}

function assignedGateSymbol(call, checker) {
  let value = call;
  let bindingIndex = null;
  while (value.parent && (typescript.isParenthesizedExpression(value.parent) ||
         typescript.isAsExpression(value.parent) || typescript.isTypeAssertionExpression(value.parent) ||
         typescript.isNonNullExpression(value.parent) || typescript.isSatisfiesExpression(value.parent) ||
         typescript.isAwaitExpression(value.parent))) value = value.parent;

  if (typescript.isArrayLiteralExpression(value.parent)) {
    const array = value.parent;
    bindingIndex = array.elements.findIndex((element) => element === value);
    const promiseCall = array.parent;
    if (bindingIndex === -1 || !typescript.isCallExpression(promiseCall) ||
        promiseCall.arguments[0] !== array || promiseCall.arguments.length !== 1 ||
        !typescript.isPropertyAccessExpression(promiseCall.expression) ||
        !typescript.isIdentifier(promiseCall.expression.expression) ||
        promiseCall.expression.expression.text !== "Promise" || promiseCall.expression.name.text !== "all" ||
        checker.getSymbolAtLocation(promiseCall.expression.expression)) return null;
    value = promiseCall;
    while (value.parent && (typescript.isParenthesizedExpression(value.parent) ||
           typescript.isAsExpression(value.parent) || typescript.isTypeAssertionExpression(value.parent) ||
           typescript.isNonNullExpression(value.parent) || typescript.isSatisfiesExpression(value.parent) ||
           typescript.isAwaitExpression(value.parent))) value = value.parent;
  }

  const declaration = value.parent;
  if (!typescript.isVariableDeclaration(declaration) || declaration.initializer !== value ||
      !typescript.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & typescript.NodeFlags.Const)) return null;
  let name = declaration.name;
  if (bindingIndex !== null) {
    if (!typescript.isArrayBindingPattern(name)) return null;
    const binding = name.elements[bindingIndex];
    if (!binding || typescript.isOmittedExpression(binding) || binding.dotDotDotToken) return null;
    name = binding.name;
  }
  if (!typescript.isIdentifier(name)) return null;
  return { name, symbol: checker.getSymbolAtLocation(name) };
}

function resolveLocalModule(ref, sourcePath, moduleName) {
  if (!moduleName.startsWith(".") && !moduleName.startsWith("@/")) return null;
  const base = moduleName.startsWith("@/")
    ? pathPosix.normalize(`src/${moduleName.slice(2)}`)
    : pathPosix.normalize(pathPosix.join(pathPosix.dirname(sourcePath), moduleName));
  if (!base.startsWith("src/")) return null;
  const candidates = /\.[jt]sx?$/.test(base) ? [base] : [
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
  ];
  for (const candidate of candidates) {
    try {
      git(["cat-file", "-e", `${ref}:${candidate}`]);
      return candidate;
    } catch {}
  }
  return null;
}

function controlsReturnedValue(node, { earlyOnly = false, after = null, independentParameters = new Set(), parameterBoolean = () => undefined, checker = null, live = null } = {}) {
  if (isStaticallyUnreachable(node)) return false;
  const fn = enclosingFunctionLike(node);
  if (fn?.asteriskToken || (!earlyOnly && (fn?.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.AsyncKeyword) ||
      fn?.parameters.some((parameter) => parameter.initializer && staticBoolean(parameter.initializer, true) === null)))) return false;
  for (let child = node, parent = node.parent; parent && !typescript.isFunctionLike(parent); child = parent, parent = parent.parent) {
    if (typescript.isTryStatement(parent) ||
        (typescript.isIfStatement(parent) && child !== parent.expression)) return false;
  }
  const parameterNames = new Set(fn?.parameters.filter((parameter) => typescript.isIdentifier(parameter.name))
    .map((parameter) => parameter.name.text));
  const localBindings = new Set();
  (function visit(item) {
    if (typescript.isVariableDeclaration(item)) {
      (function binding(name) {
        if (typescript.isIdentifier(name)) localBindings.add(name.text);
        else typescript.forEachChild(name, binding);
      })(item.name);
    }
    if (!typescript.isFunctionLike(item)) typescript.forEachChild(item, visit);
  })(fn?.body ?? node);
  let conditionalGuard = false;
  let conditionalOutput = false;
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (typescript.isReturnStatement(parent) && child === parent.expression) return !earlyOnly || conditionalOutput;
    if (typescript.isArrowFunction(parent) && child === parent.body) return !earlyOnly || conditionalOutput;
    if (typescript.isParenthesizedExpression(parent) || typescript.isAsExpression(parent) ||
        typescript.isTypeAssertionExpression(parent) || typescript.isNonNullExpression(parent) ||
        typescript.isSatisfiesExpression(parent) || typescript.isAwaitExpression(parent)) continue;
    if (typescript.isPrefixUnaryExpression(parent) &&
        parent.operator === typescript.SyntaxKind.ExclamationToken) {
      if (earlyOnly && conditionalOutput) return false;
      continue;
    }
    if (typescript.isBinaryExpression(parent)) {
      if (parent.operatorToken.kind === typescript.SyntaxKind.CommaToken) return false;
      if (parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ||
          parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken) {
        const other = child === parent.left ? parent.right : parent.left;
        let repeated = false;
        (function visit(item) {
          if (typescript.isIdentifier(item) &&
              !(typescript.isPropertyAccessExpression(item.parent) && item.parent.name === item) &&
              (item.text === node.text || localBindings.has(item.text) ||
              (parameterNames.has(item.text) &&
                !independentParameters.has(item.text)))) repeated = true;
          if (!repeated) typescript.forEachChild(item, visit);
        })(other);
        if (repeated || (earlyOnly && branchIsNullishOrEmpty(other, true))) return false;
        const value = staticBoolean(other, true) ?? parameterBoolean(other);
        if (value === undefined) return false;
        if ((parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken && value === false) ||
            (parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken && value === true)) return false;
        if (child === parent.left && value !== null) conditionalOutput = true;
        continue;
      }
      const other = child === parent.left ? parent.right : parent.left;
      if (!earlyOnly && (parent.operatorToken.kind === typescript.SyntaxKind.EqualsEqualsToken ||
           parent.operatorToken.kind === typescript.SyntaxKind.EqualsEqualsEqualsToken ||
           parent.operatorToken.kind === typescript.SyntaxKind.ExclamationEqualsToken ||
           parent.operatorToken.kind === typescript.SyntaxKind.ExclamationEqualsEqualsToken) &&
          [typescript.SyntaxKind.TrueKeyword, typescript.SyntaxKind.FalseKeyword]
            .includes(unwrapArgumentExpression(other).kind) &&
          (unwrapArgumentExpression(child) === node ||
           (typescript.isPrefixUnaryExpression(unwrapArgumentExpression(child)) &&
            unwrapArgumentExpression(child).operator === typescript.SyntaxKind.ExclamationToken))) continue;
      return false;
    }
    if (typescript.isIfStatement(parent) && child === parent.expression) {
      if (conditionalGuard || !typescript.isBlock(parent.parent) || !typescript.isFunctionLike(parent.parent.parent)) return false;
      const statements = parent.parent.statements;
      const index = statements.indexOf(parent);
      if (after) {
        let declaration = after;
        while (declaration.parent && declaration.parent !== parent.parent) declaration = declaration.parent;
        const declarationIndex = statements.indexOf(declaration);
        if (declarationIndex === -1 || declarationIndex >= index) return false;
      }
      const straightLine = (statement) => typescript.isVariableStatement(statement) || typescript.isEmptyStatement(statement);
      if (!statements.slice(0, index).every(straightLine)) return false;
      let whenTrue = parent.thenStatement;
      const following = statements.slice(index + 1).find((statement) => !straightLine(statement));
      let whenFalse = parent.elseStatement ?? following;
      if (typescript.isBlock(whenTrue) && whenTrue.statements.length === 1) whenTrue = whenTrue.statements[0];
      if (whenFalse && typescript.isBlock(whenFalse) && whenFalse.statements.length === 1) whenFalse = whenFalse.statements[0];
      if (!typescript.isReturnStatement(whenTrue) || !whenFalse || !typescript.isReturnStatement(whenFalse) ||
          !whenTrue.expression || !whenFalse.expression ||
          branchesStaticallyEquivalent(whenTrue.expression, whenFalse.expression) ||
          (earlyOnly && branchIsNullishOrEmpty(whenTrue, true) === branchIsNullishOrEmpty(whenFalse, true))) return false;
      const a = staticBoolean(whenTrue.expression, true), b = staticBoolean(whenFalse.expression, true);
      return a !== null && b !== null && (earlyOnly || a !== b);
    }
    if (earlyOnly && conditionalOutput && typescript.isJsxExpression(parent) && checker && live) {
      return jsxResultIsConsumed(parent, checker, live, new Set(), false);
    }
    if (typescript.isConditionalExpression(parent)) {
      conditionalGuard = true;
      if (child === parent.condition) {
        if (earlyOnly && branchIsNullishOrEmpty(parent.whenTrue, true) === branchIsNullishOrEmpty(parent.whenFalse, true)) return false;
        const whenTrue = staticBoolean(parent.whenTrue, true);
        const whenFalse = staticBoolean(parent.whenFalse, true);
        if (whenTrue === null || whenFalse === null ||
            (!earlyOnly && whenTrue === whenFalse) ||
            (earlyOnly && branchesStaticallyEquivalent(parent.whenTrue, parent.whenFalse))) return false;
        conditionalOutput = true;
      } else {
        return false;
      }
      continue;
    }
    return false;
  }
  return false;
}

function importedParameterControlsReturnValue(ref, sourcePath, imported, argumentIndex, argumentCount, independentArguments, argumentBoolean) {
  const targetPath = resolveLocalModule(ref, sourcePath, imported.module);
  if (!targetPath) return false;
  const source = git(["show", `${ref}:${targetPath}`]);
  const scriptKind = targetPath.endsWith(".tsx") ? typescript.ScriptKind.TSX :
    targetPath.endsWith(".jsx") ? typescript.ScriptKind.JSX :
    targetPath.endsWith(".ts") ? typescript.ScriptKind.TS : typescript.ScriptKind.JS;
  const sourceFile = typescript.createSourceFile(
    targetPath,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const options = { noResolve: true, jsx: typescript.JsxEmit.Preserve, target: typescript.ScriptTarget.Latest };
  const host = {
    getSourceFile: (fileName) => fileName === targetPath ? sourceFile : undefined,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (fileName) => fileName === targetPath,
    readFile: (fileName) => fileName === targetPath ? source : undefined,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = typescript.createProgram([targetPath], options, host);
  const syntaxErrors = program.getSyntacticDiagnostics(sourceFile);
  if (syntaxErrors.length > 0) throw new Error(`invalid ${targetPath}: ${syntaxErrors[0].messageText}`);
  const checker = program.getTypeChecker();
  const declaration = sourceFile.statements.find((statement) =>
    typescript.isFunctionDeclaration(statement) && statement.name?.text === imported.imported &&
    statement.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword));
  const parameter = declaration?.parameters[argumentIndex];
  if (!declaration?.body || !parameter || !typescript.isIdentifier(parameter.name)) return false;
  const symbol = checker.getSymbolAtLocation(parameter.name);
  const written = writtenBindingSymbols(sourceFile, checker);
  if (!symbol || written.has(symbol)) return false;

  const parameterSymbols = new Set(declaration.parameters.map((item) => checker.getSymbolAtLocation(item.name)));
  const independentParameters = new Set(declaration.parameters.flatMap((item, index) => {
    let dependentDefault = false;
    function visitDefault(node) {
      if (typescript.isIdentifier(node) && parameterSymbols.has(checker.getSymbolAtLocation(node))) dependentDefault = true;
      typescript.forEachChild(node, visitDefault);
    }
    if (item.initializer) visitDefault(item.initializer);
    const independent = independentArguments.has(index) ||
      (index >= argumentCount && (!item.initializer || staticBoolean(item.initializer, true) !== null));
    return independent && typescript.isIdentifier(item.name) && !dependentDefault &&
      !written.has(checker.getSymbolAtLocation(item.name)) ? [item.name.text] : [];
  }));
  const parameterBoolean = (expression) => {
    const properties = [];
    let value = unwrapArgumentExpression(expression);
    if (typescript.isPrefixUnaryExpression(value) && value.operator === typescript.SyntaxKind.ExclamationToken) {
      const operand = parameterBoolean(value.operand);
      return typeof operand === "boolean" ? !operand : operand;
    }
    while (typescript.isPropertyAccessExpression(value)) {
      properties.unshift(value.name.text);
      value = unwrapArgumentExpression(value.expression);
    }
    if (!typescript.isIdentifier(value)) return undefined;
    const index = declaration.parameters.findIndex((item) =>
      typescript.isIdentifier(item.name) && checker.getSymbolAtLocation(item.name) === checker.getSymbolAtLocation(value));
    return index < 0 || !independentParameters.has(value.text) ? undefined
      : argumentBoolean(index, properties, declaration.parameters[index].initializer);
  };
  let controls = false;
  function visit(node) {
    if (controls || typescript.isFunctionLike(node)) return;
    if (typescript.isIdentifier(node) && node !== parameter.name &&
        checker.getSymbolAtLocation(node) === symbol && controlsReturnedValue(node, { independentParameters, parameterBoolean })) {
      controls = true;
      return;
    }
    typescript.forEachChild(node, visit);
  }
  visit(declaration.body);
  return controls;
}

function importedArgumentGatesRuntime(node, ref, path, checker, importedFunctions, renderFunctions) {
  let argument = node;
  while (argument.parent && (typescript.isParenthesizedExpression(argument.parent) ||
         typescript.isAsExpression(argument.parent) || typescript.isTypeAssertionExpression(argument.parent) ||
         typescript.isNonNullExpression(argument.parent) || typescript.isSatisfiesExpression(argument.parent))) {
    argument = argument.parent;
  }
  const call = argument.parent;
  if (!typescript.isCallExpression(call) || !typescript.isIdentifier(call.expression)) return false;
  const argumentIndex = call.arguments.findIndex((item) => item === argument);
  const imported = importedFunctions.get(checker.getSymbolAtLocation(call.expression));
  if (argumentIndex === -1 || !imported || isStaticallyUnreachable(node)) return false;
  const independentArguments = new Set();
  const written = writtenBindingSymbols(node.getSourceFile(), checker);
  const flagSymbol = checker.getSymbolAtLocation(node);
  call.arguments.forEach((value, index) => {
    if (index === argumentIndex) return;
    let dependent = false;
    const seen = new Set();
    (function visit(item) {
      if (dependent) return;
      if (typescript.isCallExpression(item) || typescript.isElementAccessExpression(item)) {
        dependent = true;
        return;
      }
      if (typescript.isIdentifier(item) &&
          !(typescript.isPropertyAccessExpression(item.parent) && item.parent.name === item) &&
          !(typescript.isPropertyAssignment(item.parent) && item.parent.name === item)) {
        const symbol = typescript.isShorthandPropertyAssignment(item.parent)
          ? checker.getShorthandAssignmentValueSymbol(item.parent) : checker.getSymbolAtLocation(item);
        if (!symbol) return;
        if (symbol === flagSymbol || written.has(symbol) || seen.has(symbol)) {
          dependent = true;
          return;
        }
        seen.add(symbol);
        for (const declaration of symbol.declarations ?? []) {
          let binding = declaration;
          while (typescript.isBindingElement(binding) || typescript.isObjectBindingPattern(binding) ||
                 typescript.isArrayBindingPattern(binding)) {
            if (binding.initializer) visit(binding.initializer);
            binding = binding.parent;
          }
          if (typescript.isVariableDeclaration(binding) && binding.initializer) visit(binding.initializer);
          else if (typescript.isParameter(binding)) {
            if (binding.initializer) visit(binding.initializer);
          } else dependent = true;
        }
        seen.delete(symbol);
        return;
      }
      typescript.forEachChild(item, visit);
    })(value);
    if (!dependent) independentArguments.add(index);
  });
  const argumentBoolean = (index, properties, defaultValue) => {
    const seen = new Set();
    function resolve(value, fields, applyDefault = true) {
      value = unwrapArgumentExpression(value);
      if (typescript.isIdentifier(value)) {
        const symbol = checker.getSymbolAtLocation(value);
        if (symbol && !written.has(symbol) && !seen.has(symbol)) {
          const declaration = symbol.valueDeclaration;
          if (declaration && typescript.isVariableDeclaration(declaration) && declaration.initializer &&
              typescript.isVariableDeclarationList(declaration.parent) &&
              (declaration.parent.flags & typescript.NodeFlags.Const)) {
            seen.add(symbol);
            const result = resolve(declaration.initializer, fields, applyDefault);
            seen.delete(symbol);
            return result;
          }
        }
      }
      if (applyDefault && defaultValue && ((typescript.isIdentifier(value) && value.text === "undefined") ||
          typescript.isVoidExpression(value))) value = defaultValue;
      if (fields.length === 0) {
        const boolean = staticBoolean(value, true);
        if (boolean !== null) return boolean;
        return typescript.isIdentifier(value) || typescript.isPropertyAccessExpression(value) ? null : undefined;
      }
      if (!typescript.isObjectLiteralExpression(value)) {
        return typescript.isIdentifier(value) || typescript.isPropertyAccessExpression(value) ? null : undefined;
      }
      if (fields[0] === "__proto__" || value.properties.some((property) =>
          !typescript.isPropertyAssignment(property) || typescript.isComputedPropertyName(property.name))) return undefined;
      const matches = value.properties.filter((property) => property.name.text === fields[0]);
      if (matches.length !== 1) return undefined;
      return resolve(matches[0].initializer, fields.slice(1), false);
    }
    const value = call.arguments[index] ?? defaultValue;
    if (!value) return properties.length === 0 ? false : undefined;
    return resolve(value, properties);
  };
  if (!importedParameterControlsReturnValue(ref, path, imported, argumentIndex, call.arguments.length, independentArguments, argumentBoolean)) return false;
  const sourceFile = node.getSourceFile();
  const live = collectLiveFunctions(sourceFile, checker);
  return gatesRuntimeBehavior(call, checker, sourceFile,
    (reference) => renderFunctions.has(enclosingFunctionLike(reference))
      ? controlsReturnedValue(reference, { earlyOnly: true, after: call, checker, live: renderFunctions })
      : controlsRuntimeBranch(reference, false), live,
    (value) => renderFunctions.has(enclosingFunctionLike(value))
      ? controlsReturnedValue(value, { earlyOnly: true, checker, live: renderFunctions }) : controlsRuntimeBranch(value, false));
}

function gatesRuntimeBehavior(call, checker, sourceFile, referenceGates = controlsRuntimeBranch, liveFunctions = null,
    directGates = controlsRuntimeBranch) {
  const live = liveFunctions ?? collectLiveFunctions(sourceFile, checker);
  if (!callEnclosingFunctionIsLive(call, sourceFile, checker, live)) return false;
  if (directGates(call)) return true;
  const assigned = assignedGateSymbol(call, checker);
  if (!assigned?.symbol) return false;

  let usedAsGate = false;
  function visit(node) {
    if (usedAsGate) return;
    if (typescript.isIdentifier(node) && node !== assigned.name &&
        checker.getSymbolAtLocation(node) === assigned.symbol &&
        callEnclosingFunctionIsLive(node, sourceFile, checker, live) &&
        referenceGates(node)) {
      usedAsGate = true;
      return;
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  return usedAsGate;
}

function functionContainsJsx(fn) {
  let found = false;
  function visit(node) {
    if (found) return;
    if (node !== fn && typescript.isFunctionLike(node)) return;
    if (typescript.isJsxElement(node) || typescript.isJsxSelfClosingElement(node) ||
        typescript.isJsxFragment(node)) {
      found = true;
      return;
    }
    typescript.forEachChild(node, visit);
  }
  visit(fn);
  return found;
}

function exportedJsxEntryHasTicketGate(
  checker,
  helperSymbols,
  flagSymbols,
  registry,
  allowedKeys,
  addedLines,
  sourceFile,
  liveFunctions,
  renderFunctions,
  ref,
  path,
  importedFunctions,
) {
  let found = false;
  function visit(node) {
    if (found) return;
    if (typescript.isFunctionLike(node) && !liveFunctions.has(node)) return;
    if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression) &&
        helperSymbols.has(checker.getSymbolAtLocation(node.expression)) &&
        liveFunctions.has(enclosingFunctionLike(node)) && !isStaticallyUnreachable(node)) {
      let argument = node.arguments[0];
      while (argument && (typescript.isParenthesizedExpression(argument) ||
             typescript.isAsExpression(argument) || typescript.isTypeAssertionExpression(argument) ||
             typescript.isNonNullExpression(argument) || typescript.isSatisfiesExpression(argument))) {
        argument = argument.expression;
      }
      let key = null;
      if (argument && (typescript.isStringLiteral(argument) || typescript.isNoSubstitutionTemplateLiteral(argument)) &&
          registry.byValue.has(argument.text)) key = argument.text;
      else if (argument && typescript.isIdentifier(argument)) {
        key = flagSymbols.get(checker.getSymbolAtLocation(argument)) ?? null;
      }
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const callChanged = Array.from(addedLines).some((line) => line >= startLine && line <= endLine);
      if (key && allowedKeys.has(key) && callChanged &&
          gatesRuntimeBehavior(node, checker, sourceFile, (reference) =>
            controlsRuntimeBranch(reference) || importedArgumentGatesRuntime(
              reference,
              ref,
              path,
              checker,
              importedFunctions,
              renderFunctions,
            ), liveFunctions)) {
        found = true;
        return;
      }
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function hasUngatedExportedJsxEntry(
  sourceFile,
  baseSourceFile,
  checker,
  helperSymbols,
  flagSymbols,
  registry,
  allowedKeys,
  addedLines,
  changedLines,
  ref,
  path,
  importedFunctions,
) {
  const functions = [];
  function collect(node) {
    if (typescript.isFunctionLike(node)) functions.push(node);
    typescript.forEachChild(node, collect);
  }
  collect(sourceFile);
  const containsChangedLine = (node) => {
    const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    return [...changedLines].some((line) => line >= startLine && line <= endLine);
  };
  const moduleState = (file) => file.statements.filter((statement) => {
    if (typescript.isImportDeclaration(statement) || typescript.isExportDeclaration(statement) ||
        typescript.isInterfaceDeclaration(statement) || typescript.isTypeAliasDeclaration(statement) ||
        typescript.isFunctionDeclaration(statement)) return false;
    return !typescript.isVariableStatement(statement) ||
      !statement.declarationList.declarations.every((declaration) =>
        declaration.initializer && typescript.isFunctionLike(unwrapArgumentExpression(declaration.initializer)));
  }).map((statement) => statement.getText(file)).join("\n");
  const runtimeImports = (file) => {
    const bindings = new Set();
    for (const statement of file.statements) {
      if (!typescript.isImportDeclaration(statement) || !typescript.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const moduleName = statement.moduleSpecifier.text;
      if (!clause) { bindings.add(`${moduleName}:side-effect`); continue; }
      if (clause.name) bindings.add(`${moduleName}:default:${clause.name.text}`);
      const named = clause.namedBindings;
      if (named && typescript.isNamespaceImport(named)) bindings.add(`${moduleName}:*:${named.name.text}`);
      if (named && typescript.isNamedImports(named)) {
        for (const binding of named.elements) {
          if (!binding.isTypeOnly) bindings.add(`${moduleName}:${binding.propertyName?.text ?? binding.name.text}:${binding.name.text}`);
        }
      }
    }
    return bindings;
  };
  const beforeImports = runtimeImports(baseSourceFile), afterImports = runtimeImports(sourceFile);
  const importsChanged = [...beforeImports].some((binding) => !afterImports.has(binding)) ||
    [...afterImports].some((binding) => binding.endsWith(":side-effect") && !beforeImports.has(binding));
  const moduleChanged = importsChanged || moduleState(sourceFile) !== moduleState(baseSourceFile);
  const identifierExports = identifierDefaultExportFunctions(sourceFile, checker);
  for (const fn of functions) {
    if (!isExportedUiEntry(fn, identifierExports) || !functionContainsJsx(fn)) continue;
    const entryFunctions = collectLiveFunctions(sourceFile, checker, new Set([fn]));
    const entryChanged = moduleChanged || !entryFunctions.has(fn) ||
      [...entryFunctions].some(containsChangedLine);
    if (!entryChanged) continue;
    if (!exportedJsxEntryHasTicketGate(
      checker,
      helperSymbols,
      flagSymbols,
      registry,
      allowedKeys,
      addedLines,
      sourceFile,
      entryFunctions,
      collectLiveFunctions(sourceFile, checker, new Set([fn]), true),
      ref,
      path,
      importedFunctions,
    )) return true;
  }
  return false;
}

function referencesFlagAtRuntime(ref, path, registry, allowedKeys, addedLines, changedLines, baseRef) {
  const source = git(["show", `${ref}:${path}`]);
  let scriptKind = typescript.ScriptKind.JS;
  if (path.endsWith(".tsx")) scriptKind = typescript.ScriptKind.TSX;
  else if (path.endsWith(".ts")) scriptKind = typescript.ScriptKind.TS;
  else if (path.endsWith(".jsx")) scriptKind = typescript.ScriptKind.JSX;
  const sourceFile = typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const baseSource = git(["ls-tree", "--name-only", baseRef, "--", path]).trim()
    ? git(["show", `${baseRef}:${path}`]) : "";
  const baseSourceFile = typescript.createSourceFile(path, baseSource, typescript.ScriptTarget.Latest, true, scriptKind);
  const options = { noResolve: true, jsx: typescript.JsxEmit.Preserve, target: typescript.ScriptTarget.Latest };
  const host = {
    getSourceFile: (fileName) => fileName === path ? sourceFile : undefined,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (fileName) => fileName === path,
    readFile: (fileName) => fileName === path ? source : undefined,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = typescript.createProgram([path], options, host);
  const syntaxErrors = program.getSyntacticDiagnostics(sourceFile);
  if (syntaxErrors.length > 0) throw new Error(`invalid ${path}: ${syntaxErrors[0].messageText}`);
  const checker = program.getTypeChecker();
  const helperSymbols = new Set();
  const flagSymbols = new Map();
  const importedFunctions = new Map();
  const liveFunctions = collectLiveFunctions(sourceFile, checker);
  const renderFunctions = collectLiveFunctions(sourceFile, checker, null, true);

  for (const statement of sourceFile.statements) {
    if (!typescript.isImportDeclaration(statement) || !typescript.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !typescript.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      const symbol = checker.getSymbolAtLocation(specifier.name);
      if (!symbol) continue;
      importedFunctions.set(symbol, { imported, module: moduleName });
      if ((moduleName === "@/hooks/useFlag" && imported === "useFlag" && !isServerFile(path)) ||
          (moduleName === "@/lib/flags" && imported === "isFeatureEnabled")) helperSymbols.add(symbol);
      const key = registry.byIdentifier.get(imported);
      if (!key) continue;
      if (!FLAG_KEY_MODULES.has(moduleName)) {
        const definitionPath = moduleName.startsWith("@/lib/flags/definitions/")
          ? `src/${moduleName.slice(2)}${moduleName.endsWith(".ts") ? "" : ".ts"}`
          : resolveLocalModule(ref, path, moduleName);
        if (!definitionPath || !flagDefinitionPaths(ref).includes(definitionPath)) continue;
        const { identifier, definition } = parseFlagFile(git(["show", `${ref}:${definitionPath}`]), definitionPath);
        if (identifier !== imported || definition.key !== key) continue;
      }
      flagSymbols.set(symbol, key);
    }
  }

  if (isUiFile(path) && hasUngatedExportedJsxEntry(
    sourceFile,
    baseSourceFile,
    checker,
    helperSymbols,
    flagSymbols,
    registry,
    allowedKeys,
    addedLines,
    changedLines,
    ref,
    path,
    importedFunctions,
  )) {
    return null;
  }

  let found = null;
  function visit(node) {
    if (found) return;
    if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression) &&
        helperSymbols.has(checker.getSymbolAtLocation(node.expression)) && !isStaticallyUnreachable(node)) {
      let argument = node.arguments[0];
      while (argument && (typescript.isParenthesizedExpression(argument) ||
             typescript.isAsExpression(argument) || typescript.isTypeAssertionExpression(argument) ||
             typescript.isNonNullExpression(argument) || typescript.isSatisfiesExpression(argument))) {
        argument = argument.expression;
      }
      let key = null;
      if (argument && (typescript.isStringLiteral(argument) || typescript.isNoSubstitutionTemplateLiteral(argument)) &&
          registry.byValue.has(argument.text)) key = argument.text;
      else if (argument && typescript.isIdentifier(argument)) {
        key = flagSymbols.get(checker.getSymbolAtLocation(argument)) ?? null;
      }
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const callChanged = Array.from(addedLines).some((line) => line >= startLine && line <= endLine);
      if (key && allowedKeys.has(key) && callChanged &&
          gatesRuntimeBehavior(node, checker, sourceFile, (reference) =>
            controlsRuntimeBranch(reference) || importedArgumentGatesRuntime(
              reference,
              ref,
              path,
              checker,
              importedFunctions,
              renderFunctions,
            ), liveFunctions)) found = key;
    }
    if (!found) typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function apiRouteForSourcePath(path) {
  const appRoute = path.match(/^src\/app\/api\/(?:(.+)\/)?route\.[jt]sx?$/);
  const pagesRoute = path.match(/^src\/pages\/api\/(.+)\.[jt]sx?$/);
  if (!appRoute && !pagesRoute) return null;
  let relative = appRoute ? (appRoute[1] ?? "") : pagesRoute[1];
  if (pagesRoute) relative = relative === "index" ? "" : relative.replace(/\/index$/, "");
  const route = relative ? `/api/${relative}` : "/api";
  const staticParts = route.split(/\[\[\.{3}[^\]]+\]\]|\[\.{3}[^\]]+\]|\[[^\]]+\]/);
  return staticParts.length === 1 ? { route, dynamic: false } :
    { route, dynamic: true, staticParts };
}

function sourceReferencesApiRoute(ref, path, apiRoute) {
  let source;
  try {
    source = git(["show", `${ref}:${path}`]);
  } catch {
    return false;
  }
  const scriptKind = path.endsWith(".tsx") ? typescript.ScriptKind.TSX :
    path.endsWith(".jsx") ? typescript.ScriptKind.JSX :
    path.endsWith(".ts") ? typescript.ScriptKind.TS : typescript.ScriptKind.JS;
  const sourceFile = typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const options = { noResolve: true, jsx: typescript.JsxEmit.Preserve, target: typescript.ScriptTarget.Latest };
  const host = {
    getSourceFile: (fileName) => fileName === path ? sourceFile : undefined,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (fileName) => fileName === path,
    readFile: (fileName) => fileName === path ? source : undefined,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = typescript.createProgram([path], options, host);
  const syntaxErrors = program.getSyntacticDiagnostics(sourceFile);
  if (syntaxErrors.length > 0) throw new Error(`invalid ${path}: ${syntaxErrors[0].messageText}`);
  const checker = program.getTypeChecker();

  function isRequestUrl(node) {
    let value = typescript.isTemplateHead(node) && typescript.isTemplateExpression(node.parent) ? node.parent : node;
    while (value.parent && (typescript.isParenthesizedExpression(value.parent) ||
           typescript.isAsExpression(value.parent) || typescript.isTypeAssertionExpression(value.parent) ||
           typescript.isNonNullExpression(value.parent) || typescript.isSatisfiesExpression(value.parent))) {
      value = value.parent;
    }
    while (value.parent && typescript.isBinaryExpression(value.parent) && value.parent.left === value &&
           value.parent.operatorToken.kind === typescript.SyntaxKind.PlusToken) value = value.parent;
    const call = value.parent;
    return typescript.isCallExpression(call) && call.arguments[0] === value &&
      typescript.isIdentifier(call.expression) && call.expression.text === "fetch" &&
      !checker.getSymbolAtLocation(call.expression);
  }

  function matchesRoute(node) {
    if (!apiRoute.dynamic) {
      const value = node.text;
      return value === apiRoute.route || value.startsWith(`${apiRoute.route}?`);
    }
    if (!typescript.isTemplateHead(node) || !typescript.isTemplateExpression(node.parent)) return false;
    const literals = [node.text, ...node.parent.templateSpans.map((span) => span.literal.text)];
    return literals.length === apiRoute.staticParts.length && literals.every((literal, index) => {
      const expected = apiRoute.staticParts[index];
      if (index !== literals.length - 1) return literal === expected;
      return literal === expected || literal.startsWith(`${expected}?`);
    });
  }

  let found = false;
  function visit(node) {
    if (found) return;
    if ((typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node) ||
         typescript.isTemplateHead(node)) && isRequestUrl(node) && matchesRoute(node)) found = true;
    if (!found) typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function changedUiImports(ref, path, uiFiles) {
  const source = git(["show", `${ref}:${path}`]);
  const scriptKind = path.endsWith(".tsx") ? typescript.ScriptKind.TSX :
    path.endsWith(".jsx") ? typescript.ScriptKind.JSX :
    path.endsWith(".ts") ? typescript.ScriptKind.TS : typescript.ScriptKind.JS;
  const sourceFile = typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const imported = new Set();
  const uiSet = new Set(uiFiles);
  for (const statement of sourceFile.statements) {
    if (!typescript.isImportDeclaration(statement) ||
        !typescript.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    let base = null;
    if (moduleName.startsWith(".")) {
      base = pathPosix.normalize(pathPosix.join(pathPosix.dirname(path), moduleName));
    } else if (moduleName.startsWith("@/")) {
      base = `src/${moduleName.slice(2)}`;
    }
    if (!base) continue;
    const candidates = /\.[a-z]+$/i.test(base) ? [base] : [
      `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.css`,
      `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
    ];
    const matched = candidates.find((candidate) => uiSet.has(candidate));
    if (matched) imported.add(matched);
  }
  return imported;
}

function changedUiDependencyTree(ref, path, uiFiles, seen = new Set()) {
  if (seen.has(path)) return seen;
  seen.add(path);
  if (!/\.[jt]sx?$/.test(path)) return seen;
  for (const imported of changedUiImports(ref, path, uiFiles)) {
    changedUiDependencyTree(ref, imported, uiFiles, seen);
  }
  return seen;
}

function uiTreeReferencesApiRoute(ref, path, uiFiles, apiRoute, seen = new Set()) {
  if (seen.has(path)) return false;
  seen.add(path);
  if (sourceReferencesApiRoute(ref, path, apiRoute)) return true;
  return Array.from(changedUiImports(ref, path, uiFiles))
    .some((imported) => uiTreeReferencesApiRoute(ref, imported, uiFiles, apiRoute, seen));
}

function runtimeGateCoveredUiFiles(ref, path, uiFiles) {
  if (isUiFile(path)) return changedUiDependencyTree(ref, path, uiFiles);
  const apiRoute = apiRouteForSourcePath(path);
  if (!apiRoute) return new Set();
  return new Set(uiFiles.filter((uiPath) => /\.[jt]sx?$/.test(uiPath) &&
    uiTreeReferencesApiRoute(ref, uiPath, uiFiles, apiRoute)));
}

function isVerifiedAutoRevert(title, baseSha, headSha) {
  if (!/^Revert "(?:HTPR|HYFA)-\d+ \[[^\]]+\] .+"$/.test(title)) return false;
  const mergeBase = git(["merge-base", baseSha, headSha]).trim();
  if (git(["rev-list", "--count", `${mergeBase}..${headSha}`]).trim() !== "1") return false;
  const message = git(["show", "-s", "--format=%s%n%b", headSha]);
  if (message.split("\n", 1)[0] !== title) return false;
  const reverted = message.match(/This reverts commit ([0-9a-f]{40})\./)?.[1]
    ?? message.match(/^Auto-revert-of: ([0-9a-f]{40})$/m)?.[1];
  if (!reverted) return false;
  try {
    git(["merge-base", "--is-ancestor", reverted, baseSha]);
    const revertedParent = git(["rev-parse", `${reverted}^`]).trim();
    const options = ["diff", "--binary", "--full-index", "--no-renames"];
    const actualReversePatch = git([...options, mergeBase, headSha]);
    const expectedReversePatch = git([...options, reverted, revertedParent]);
    return actualReversePatch === expectedReversePatch;
  } catch {
    return false;
  }
}

function failure(reason) {
  return { pass: false, reason };
}

function normalizePolicyToken(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function labelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map((label) => {
    if (typeof label === "string") return label;
    if (label && typeof label.name === "string") return label.name;
    return "";
  }).filter(Boolean);
}

function isExemptTitleTag(tag) {
  return Boolean(tag) && EXEMPT_TAGS.has(normalizePolicyToken(tag));
}

function hasAiChatLabel(labels) {
  return labelNames(labels).some((name) => normalizePolicyToken(name) === "AI CHAT");
}

function readLabelsFromEnv() {
  const raw = process.env.FEATURE_FLAG_PR_LABELS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return labelNames(parsed);
  } catch {
    throw new Error("FEATURE_FLAG_PR_LABELS must be a JSON array of label names");
  }
}

export function evaluate({ title, baseSha, headSha, labels = [] }) {
  const changedFiles = git(["diff", "--name-only", `${baseSha}...${headSha}`])
    .split("\n").filter(Boolean);
  if (changedFiles.some((path) => ["src/lib/flags/keys.ts", "src/lib/flags.ts", "src/lib/flags/definitions.ts", "src/lib/flags/releaseRisk.ts"].includes(path) || path.startsWith("src/lib/flags/definitions/"))) {
    try {
      const mergeBase = git(["merge-base", baseSha, headSha]).trim();
      const baseRegistry = parseFlagRegistry(mergeBase);
      const headRegistry = parseFlagRegistry(headSha);
      const added = new Set([...headRegistry.byValue.keys()].filter((key) => !baseRegistry.byValue.has(key)));
      const baseDefinitions = parseDefinitions(mergeBase);
      const headDefinitions = parseDefinitions(headSha);
      for (const key of headDefinitions.keys) {
        if (!baseDefinitions.keys.includes(key)) added.add(key);
      }
      if (added.size) assertAddedFlagReleaseRisks(headSha, [...added]);
      const baseFiles = new Set(flagDefinitionPaths(mergeBase));
      for (const path of flagDefinitionPaths(headSha)) {
        if (baseFiles.has(path)) continue;
        const { definition } = parseFlagFile(git(["show", `${headSha}:${path}`]), path);
        if (!["bugfix", "internal"].includes(definition.kind) && !definition.releaseRisk?.highRisk &&
            definition.defaultMode !== "EVERYONE" &&
            !(definition.defaultMode === "OWNER_ONLY" && definition.releaseRisk?.ownerRequest)) {
          throw new Error(`new flag ${definition.key} must set defaultMode: "EVERYONE" (or releaseRisk.highRisk for money, access, data-deletion or customer-email; or defaultMode: "OWNER_ONLY" with releaseRisk.ownerRequest containing Valentin's exact quote and ticketUrl)`);
        }
      }
    } catch (error) {
      return failure(`Feature flag files or imports could not be parsed safely, or new flags need release-risk entries: ${error.message}`);
    }
  }
  const uiFiles = changedFiles.filter(isUiFile);
  const serverFiles = changedFiles.filter(isServerFile).filter((path) =>
    git(["ls-tree", "--name-only", headSha, "--", path]).trim());
  const runtimeFiles = changedFiles.filter((path) =>
    /^src\//.test(path) && /\.[jt]sx?$/.test(path) &&
    !/(^|\/)tests?\//.test(path) && !/\.(test|spec)\.[jt]sx?$/.test(path) &&
    !/\.stories\.[jt]sx?$/.test(path));
  if (uiFiles.length === 0 && serverFiles.length === 0) {
    return { pass: true, ownerReview: null, reason: "No changed file matches the UI/server-change path filter." };
  }

  // Title exemptions never bypass registry default validation.
  if (changedFiles.some((path) => ["src/lib/flags.ts", "src/lib/flags/definitions.ts"].includes(path) || path.startsWith("src/lib/flags/definitions/"))) {
    try {
      parseDefinitions(headSha);
    } catch (error) {
      return failure(`Feature flag files or imports could not be parsed safely: ${error.message}`);
    }
  }

  if (/^YPER4-\d+ \[[^\]]+\] \S/.test(title)) {
    return { pass: true, ownerReview: "exempt-ui", reason: "Infra ticket: no flag required" };
  }

  const titleMatch = title.match(/^(?:HTPR|HYFA)-(\d+) \[([^\]]+)\] \S/);
  const autoRevert = isVerifiedAutoRevert(title, baseSha, headSha);
  const tag = titleMatch?.[2] ?? null;
  if (tag === "REFACTOR") {
    const { uiAdded, moved, newLines, riskyNew } = refactorUiLineCounts(baseSha, headSha);
    if (riskyNew > CROSS_CHECK_LINE_BUDGET) {
      return failure(
        `This [REFACTOR] pull request adds ${riskyNew} new UI lines that are not moved code ` +
        `(over the ${CROSS_CHECK_LINE_BUDGET}-line budget). Retitle it as [FEATURE] with a feature flag or split it.`,
      );
    }
    return {
      pass: true,
      ownerReview: "exempt-ui",
      reason: `[REFACTOR] is exempt (${uiAdded} UI lines added, ${moved} moved, ${newLines} new, ${riskyNew} risky new).`,
    };
  }
  const titleExempt = isExemptTitleTag(tag);
  const aiChatLabel = hasAiChatLabel(labels);
  const exempt = autoRevert || titleExempt || aiChatLabel;
  let widened = null;
  if (exempt) {
    const uiAdded = git(["diff", "--numstat", "--no-renames", `${baseSha}...${headSha}`])
      .split("\n").filter(Boolean)
      .map((line) => {
        const [added, , ...pathParts] = line.split("\t");
        return { added: added === "-" ? 0 : Number(added), path: pathParts.join("\t") };
      })
      .filter((row) => isUiFile(row.path))
      .reduce((sum, row) => sum + row.added, 0);
    const exemptionLabel = autoRevert
      ? "as an auto-revert"
      : titleExempt
        ? `[${tag}]`
        : "AI CHAT label";
    if (uiAdded > CROSS_CHECK_LINE_BUDGET) {
      return failure(
        `This pull request is tagged ${exemptionLabel} but adds ${uiAdded} lines to UI files ` +
        `(over the ${CROSS_CHECK_LINE_BUDGET}-line budget). Retitle it as [FEATURE] and add a feature flag.`,
      );
    }
    if (titleExempt && ["BUGFIX", "INFRA"].includes(normalizePolicyToken(tag)) && !autoRevert && !aiChatLabel) {
      try {
        widened = widenedUiExposure(git(["merge-base", baseSha, headSha]).trim(), headSha, uiFiles);
      } catch (error) {
        return failure(`UI exposure could not be parsed safely: ${error.message}`);
      }
    }
    const reasonPrefix = autoRevert
      ? "Verified auto-revert"
      : titleExempt
        ? `[${tag}]`
        : "AI CHAT label";
    if (!widened) return { pass: true, ownerReview: "exempt-ui", reason: `${reasonPrefix} is exempt (${uiAdded} UI lines added).` };
  }
  if (!titleMatch) {
    return failure("The pull request title has no valid HTPR or HYFA ticket and tag, so the feature flag requirement cannot be checked.");
  }

  try {
    const mergeBase = git(["merge-base", baseSha, headSha]).trim();
    parseFlagRegistry(mergeBase);
    const headRegistry = parseFlagRegistry(headSha);
    const baseDefinitions = parseDefinitions(mergeBase);
    const headDefinitions = parseDefinitions(headSha);
    const removed = baseDefinitions.keys.filter((key) => !headDefinitions.keys.includes(key));
    if (removed.length > 0) return failure(`The pull request removes existing feature flag definition ${removed[0]}.`);

    const added = headDefinitions.keys.filter((key) => !baseDefinitions.keys.includes(key));
    const ticketPrefix = `${title.slice(0, 4).toLowerCase()}-${titleMatch[1]}-`;
    if (added.length > 0 && added.some((key) => !key.startsWith(ticketPrefix))) {
      return failure(`New feature flag keys must start with ${ticketPrefix} to match this pull request.`);
    }
    const ticketKeys = new Set(headDefinitions.keys.filter((key) => key.startsWith(ticketPrefix)));
    const requiredUiFiles = uiFiles.filter((path) => {
      try {
        git(["cat-file", "-e", `${headSha}:${path}`]);
        return true;
      } catch {
        return false;
      }
    });
    let hasServerGate = false;
    const coveredUiFiles = new Set();
    let matchedGate = null;

    for (const path of runtimeFiles) {
      try {
        git(["cat-file", "-e", `${headSha}:${path}`]);
      } catch {
        continue;
      }
      const key = referencesFlagAtRuntime(
        headSha,
        path,
        headRegistry,
        ticketKeys,
        addedLinesFor(mergeBase, headSha, path),
        addedLinesFor(mergeBase, headSha, path, true),
        mergeBase,
      );
      if (key) {
        if (isServerFile(path)) hasServerGate = true;
        const covered = runtimeGateCoveredUiFiles(headSha, path, uiFiles);
        for (const uiPath of covered) coveredUiFiles.add(uiPath);
        if ((covered.size > 0 || isServerFile(path)) && !matchedGate) matchedGate = { key, path };
      }
    }
    if (serverFiles.length > 0 && !hasServerGate) {
      return failure(`[${tag}] changes server behavior (${serverFiles.slice(0, 5).join(", ")}) without a ticket-specific server flag. ` +
        `Define src/lib/flags/definitions/${ticketPrefix}<name>.ts and call isFeatureEnabled from @/lib/flags ` +
        "with that key on an added or modified server line controlling the behavior.");
    }
    if (matchedGate && (requiredUiFiles.length === 0 ||
        requiredUiFiles.every((path) => coveredUiFiles.has(path)))) {
      return {
        pass: true,
        ownerReview: "feature-gated-ui",
        reason: `[${tag}] calls ticket-specific feature gate ${matchedGate.key} in changed code covering the changed server behavior and every UI entry from ${matchedGate.path}.`,
      };
    }
  } catch (error) {
    return failure(`Feature flag files or imports could not be parsed safely: ${error.message}`);
  }

  if (widened) {
    return failure(
      `[${tag}] shows existing UI in new places or to more users (${widened}) without a flag.` +
      " Legal, privacy, compliance and urgent work still need a flag. Add " +
      `src/lib/flags/definitions/${title.slice(0, 4).toLowerCase()}-${titleMatch[1]}-<name>.ts ` +
      '(kind "bugfix" only if it restores intended behaviour) and gate the change with useFlag/isFeatureEnabled.',
    );
  }
  const shownFiles = `${uiFiles.slice(0, 5).join(", ")}${uiFiles.length > 5 ? ", ..." : ""}`;
  return failure(
    `[${tag}] touches UI files (${shownFiles}) without a feature flag. Define a ticket-specific key in ` +
    "FEATURE_FLAG_DEFINITIONS and call useFlag/isFeatureEnabled with that key on an added or modified source line.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [title, baseSha, headSha, decisionFile] = process.argv.slice(2);
  try {
    if (!title || !baseSha || !headSha) throw new Error("title, base SHA, and head SHA are required");
    const result = evaluate({ title, baseSha, headSha, labels: readLabelsFromEnv() });
    if (decisionFile) writeFileSync(decisionFile, `${result.ownerReview ?? "automerge"}\n`);
    console.log(result.reason);
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    console.error(`Feature flag gate could not run: ${error.message}`);
    process.exitCode = 2;
  }
}
