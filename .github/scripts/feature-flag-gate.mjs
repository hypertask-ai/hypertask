import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix as pathPosix } from "node:path";
import { git, parseFlagRegistry, parseDefinitions, unwrapExpr, isBindingWrite, assertAddedFlagReleaseRisks } from "./feature-flag-registry.mjs";

const require = createRequire(import.meta.url);
const typescript = require(process.env.FEATURE_FLAG_TYPESCRIPT_PATH || "typescript");

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

function addedLinesFor(baseSha, headSha, path) {
  const lines = new Set();
  const diff = git(["diff", "--unified=0", "--no-renames", `${baseSha}...${headSha}`, "--", path]);
  for (const row of diff.split("\n")) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let line = start; line < start + count; line += 1) lines.add(line);
  }
  return lines;
}

function staticBoolean(node) {
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
  if (typescript.isNumericLiteral(node)) return Number(node.text) !== 0;
  if (typescript.isPrefixUnaryExpression(node) && node.operator === typescript.SyntaxKind.ExclamationToken) {
    const operand = staticBoolean(node.operand);
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

function branchHasBehavior(node) {
  if (!node || isStaticallyUnreachable(node) || typescript.isEmptyStatement(node)) return false;
  if (typescript.isBlock(node)) return node.statements.some(branchHasBehavior);
  if (typescript.isReturnStatement(node)) return true;
  if (typescript.isThrowStatement(node) || typescript.isBreakStatement(node) ||
      typescript.isContinueStatement(node)) return true;
  if (typescript.isExpressionStatement(node)) return expressionHasSideEffect(node.expression);
  if (typescript.isVariableStatement(node)) {
    return node.declarationList.declarations.some((declaration) =>
      declaration.initializer && expressionHasSideEffect(declaration.initializer));
  }
  if (typescript.isIfStatement(node)) {
    return branchHasBehavior(node.thenStatement) || branchHasBehavior(node.elseStatement);
  }
  if (typescript.isForStatement(node) || typescript.isForInStatement(node) ||
      typescript.isForOfStatement(node) || typescript.isWhileStatement(node) ||
      typescript.isDoStatement(node)) return branchHasBehavior(node.statement);
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

function functionBindingName(fn) {
  if (fn.name && typescript.isIdentifier(fn.name)) return fn.name;
  if (typescript.isVariableDeclaration(fn.parent) && typescript.isIdentifier(fn.parent.name) &&
      fn.parent.initializer === fn) {
    return fn.parent.name;
  }
  if (typescript.isPropertyAssignment(fn.parent) && typescript.isIdentifier(fn.parent.name) &&
      fn.parent.initializer === fn) {
    return fn.parent.name;
  }
  return null;
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

function isLiveCallSite(node, live) {
  if (isStaticallyUnreachable(node)) return false;
  const enclosing = enclosingFunctionLike(node);
  return !enclosing || live.has(enclosing);
}

function branchIsNullishOrEmpty(node) {
  if (!node) return true;
  if (typescript.isBlock(node)) {
    if (node.statements.length === 0) return true;
    if (node.statements.length === 1) return branchIsNullishOrEmpty(node.statements[0]);
    return false;
  }
  if (typescript.isReturnStatement(node)) return branchIsNullishOrEmpty(node.expression);
  const expression = unwrapExpr(node);
  if (!expression) return true;
  if (expression.kind === typescript.SyntaxKind.NullKeyword ||
      expression.kind === typescript.SyntaxKind.UndefinedKeyword ||
      expression.kind === typescript.SyntaxKind.FalseKeyword) {
    return true;
  }
  if (typescript.isIdentifier(expression) && expression.text === "undefined") return true;
  if (typescript.isStringLiteral(expression) && expression.text === "") return true;
  if (typescript.isJsxFragment(expression)) {
    return expression.children.every((child) =>
      typescript.isJsxText(child) ? child.getText().trim() === "" : false);
  }
  return false;
}

function collectLiveFunctions(sourceFile, checker) {
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
    const name = functionBindingName(fn);
    return name && writtenSymbols.has(checker.getSymbolAtLocation(name));
  }));
  // Export recognition remains intact for the ungated-sibling check, but a
  // rebound binding cannot prove which implementation runs. No flow analysis.
  const live = new Set(functions.filter((fn) => !reboundFunctions.has(fn) && isExportedUiEntry(fn, identifierExports)));
  const functionBySymbol = new Map();
  for (const fn of functions) {
    const name = functionBindingName(fn);
    const symbol = name && checker.getSymbolAtLocation(name);
    if (symbol && !writtenSymbols.has(symbol)) functionBySymbol.set(symbol, fn);
  }
  let changed = true;
  while (changed) {
    changed = false;
    // Returning a named callback from a live hook exposes that callback to its
    // callers. Resolve property values by symbol, never by matching their text.
    for (const fn of Array.from(live)) {
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
    for (const fn of functions) {
      if (live.has(fn) || reboundFunctions.has(fn)) continue;
      const name = functionBindingName(fn);
      if (!name) continue;
      const symbol = checker.getSymbolAtLocation(name);
      if (!symbol) continue;
      let referenced = false;
      function visit(node) {
        if (referenced || node === fn) return;
        if (isStaticallyUnreachable(node)) return;
        if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression) &&
            checker.getSymbolAtLocation(node.expression) === symbol &&
            isLiveCallSite(node, live)) {
          referenced = true;
          return;
        }
        if ((typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) &&
            typescript.isIdentifier(node.tagName) &&
            checker.getSymbolAtLocation(node.tagName) === symbol &&
            isLiveCallSite(node, live)) {
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

function controlsRuntimeBranch(node) {
  if (isStaticallyUnreachable(node)) return false;
  let controlsOutput = false;
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (typescript.isBinaryExpression(parent) && child === parent.left &&
        (parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ||
         parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken)) {
      const right = staticBoolean(parent.right);
      if ((parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken && right === false) ||
          (parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken && right === true)) return false;
      controlsOutput = branchHasBehavior(parent.right) || expressionResultIsObserved(parent);
      continue;
    }
    if (typescript.isConditionalExpression(parent) && child === parent.condition) {
      if (branchesStaticallyEquivalent(parent.whenTrue, parent.whenFalse) ||
          (branchIsNullishOrEmpty(parent.whenTrue) && branchIsNullishOrEmpty(parent.whenFalse))) {
        controlsOutput = false;
      } else {
        controlsOutput = (branchHasBehavior(parent.whenTrue) || branchHasBehavior(parent.whenFalse) ||
          expressionResultIsObserved(parent));
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
        controlsOutput = branchHasBehavior(parent.thenStatement) || branchHasBehavior(parent.elseStatement);
      }
      continue;
    }
    if ((typescript.isWhileStatement(parent) && child === parent.expression) ||
        (typescript.isDoStatement(parent) && child === parent.expression) ||
        (typescript.isForStatement(parent) && child === parent.condition)) {
      controlsOutput = branchHasBehavior(parent.statement);
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
        if (child === parent.right) controlsOutput ||= expressionResultIsObserved(parent);
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

function resolveRelativeModule(ref, sourcePath, moduleName) {
  if (!moduleName.startsWith(".")) return null;
  const base = pathPosix.normalize(pathPosix.join(pathPosix.dirname(sourcePath), moduleName));
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

function controlsReturnedValue(node) {
  if (isStaticallyUnreachable(node)) return false;
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (typescript.isReturnStatement(parent) && child === parent.expression) return true;
    if (typescript.isArrowFunction(parent) && child === parent.body) return true;
    if (typescript.isParenthesizedExpression(parent) || typescript.isAsExpression(parent) ||
        typescript.isTypeAssertionExpression(parent) || typescript.isNonNullExpression(parent) ||
        typescript.isSatisfiesExpression(parent) || typescript.isAwaitExpression(parent) ||
        (typescript.isPrefixUnaryExpression(parent) &&
         parent.operator === typescript.SyntaxKind.ExclamationToken)) continue;
    if (typescript.isBinaryExpression(parent)) {
      if (parent.operatorToken.kind === typescript.SyntaxKind.CommaToken) return false;
      if (parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ||
          parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken) {
        const other = child === parent.left ? parent.right : parent.left;
        const value = staticBoolean(other);
        if ((child === parent.left && parent.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken && value === false) ||
            (child === parent.left && parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken && value === true)) return false;
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
    if (typescript.isConditionalExpression(parent)) {
      if (child === parent.condition) {
        const whenTrue = staticBoolean(parent.whenTrue);
        const whenFalse = staticBoolean(parent.whenFalse);
        if (whenTrue !== null && whenTrue === whenFalse) return false;
      }
      continue;
    }
    return false;
  }
  return false;
}

function importedParameterControlsReturnValue(ref, sourcePath, imported, argumentIndex) {
  const targetPath = resolveRelativeModule(ref, sourcePath, imported.module);
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
  if (!symbol) return false;

  let controls = false;
  function visit(node) {
    if (controls) return;
    if (typescript.isIdentifier(node) && node !== parameter.name &&
        checker.getSymbolAtLocation(node) === symbol && controlsReturnedValue(node)) {
      controls = true;
      return;
    }
    typescript.forEachChild(node, visit);
  }
  visit(declaration.body);
  return controls;
}

function importedArgumentGatesRuntime(node, ref, path, checker, importedFunctions) {
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
  return Boolean(argumentIndex !== -1 && imported &&
    importedParameterControlsReturnValue(ref, path, imported, argumentIndex) &&
    gatesRuntimeBehavior(call, checker, node.getSourceFile(), () => false));
}

function gatesRuntimeBehavior(call, checker, sourceFile, referenceGates = controlsRuntimeBranch, liveFunctions = null) {
  const live = liveFunctions ?? collectLiveFunctions(sourceFile, checker);
  if (!callEnclosingFunctionIsLive(call, sourceFile, checker, live)) return false;
  if (controlsRuntimeBranch(call)) return true;
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
  fn,
  checker,
  helperSymbols,
  flagSymbols,
  registry,
  allowedKeys,
  addedLines,
  sourceFile,
  liveFunctions,
  ref,
  path,
  importedFunctions,
) {
  let found = false;
  function visit(node) {
    if (found) return;
    if (node !== fn && typescript.isFunctionLike(node)) return;
    if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression) &&
        helperSymbols.has(checker.getSymbolAtLocation(node.expression)) &&
        !isStaticallyUnreachable(node)) {
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
            ), liveFunctions)) {
        found = true;
        return;
      }
    }
    typescript.forEachChild(node, visit);
  }
  visit(fn);
  return found;
}

function hasUngatedExportedJsxEntry(
  sourceFile,
  checker,
  helperSymbols,
  flagSymbols,
  registry,
  allowedKeys,
  addedLines,
  liveFunctions,
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
  const identifierExports = identifierDefaultExportFunctions(sourceFile, checker);
  for (const fn of functions) {
    if (!isExportedUiEntry(fn, identifierExports) || !functionContainsJsx(fn)) continue;
    if (!exportedJsxEntryHasTicketGate(
      fn,
      checker,
      helperSymbols,
      flagSymbols,
      registry,
      allowedKeys,
      addedLines,
      sourceFile,
      liveFunctions,
      ref,
      path,
      importedFunctions,
    )) return true;
  }
  return false;
}

function referencesFlagAtRuntime(ref, path, registry, allowedKeys, addedLines) {
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
      if ((moduleName === "@/hooks/useFlag" && imported === "useFlag") ||
          (moduleName === "@/lib/flags" && imported === "isFeatureEnabled")) helperSymbols.add(symbol);
      if (FLAG_KEY_MODULES.has(moduleName) && registry.byIdentifier.has(imported)) {
        flagSymbols.set(symbol, registry.byIdentifier.get(imported));
      }
    }
  }

  if (isUiFile(path) && hasUngatedExportedJsxEntry(
    sourceFile,
    checker,
    helperSymbols,
    flagSymbols,
    registry,
    allowedKeys,
    addedLines,
    liveFunctions,
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
    } catch (error) {
      return failure(`Feature flag files or imports could not be parsed safely, or new flags need release-risk entries: ${error.message}`);
    }
  }
  const uiFiles = changedFiles.filter(isUiFile);
  const runtimeFiles = changedFiles.filter((path) =>
    /^src\//.test(path) && /\.[jt]sx?$/.test(path) &&
    !/(^|\/)tests?\//.test(path) && !/\.(test|spec)\.[jt]sx?$/.test(path) &&
    !/\.stories\.[jt]sx?$/.test(path));
  if (uiFiles.length === 0) {
    return { pass: true, ownerReview: null, reason: "No changed file matches the UI-change path filter." };
  }

  // Title exemptions never permit widening a feature default to Everyone.
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
    const reasonPrefix = autoRevert
      ? "Verified auto-revert"
      : titleExempt
        ? `[${tag}]`
        : "AI CHAT label";
    return { pass: true, ownerReview: "exempt-ui", reason: `${reasonPrefix} is exempt (${uiAdded} UI lines added).` };
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
      );
      if (key) {
        const covered = runtimeGateCoveredUiFiles(headSha, path, uiFiles);
        for (const uiPath of covered) coveredUiFiles.add(uiPath);
        if (covered.size > 0 && !matchedGate) matchedGate = { key, path };
      }
    }
    if (matchedGate && (requiredUiFiles.length === 0 ||
        requiredUiFiles.every((path) => coveredUiFiles.has(path)))) {
      return {
        pass: true,
        ownerReview: "feature-gated-ui",
        reason: `[${tag}] calls ticket-specific feature gate ${matchedGate.key} in changed code covering every UI entry from ${matchedGate.path}.`,
      };
    }
  } catch (error) {
    return failure(`Feature flag files or imports could not be parsed safely: ${error.message}`);
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
