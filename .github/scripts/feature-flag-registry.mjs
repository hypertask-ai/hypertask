import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const typescript = require(process.env.FEATURE_FLAG_TYPESCRIPT_PATH || "typescript");

export function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isJsxTextApostrophe(source, index) {
  if (!/[A-Za-z0-9]/.test(source[index - 1] ?? "")) return false;
  const lineStart = source.lastIndexOf("\n", index) + 1;
  const before = source.slice(lineStart, index);
  const tagStart = before.lastIndexOf("<");
  const tagEnd = before.lastIndexOf(">");
  const expressionStart = before.lastIndexOf("{");
  if (tagStart === -1 || tagEnd < tagStart || expressionStart > tagEnd) return false;

  const lineEnd = source.indexOf("\n", index);
  const after = source.slice(index + 1, lineEnd === -1 ? source.length : lineEnd);
  const nextTag = after.indexOf("<");
  const expressionEnd = after.indexOf("}");
  return nextTag !== -1 && (expressionEnd === -1 || nextTag < expressionEnd);
}

function findTemplateExpressionEnd(source, start) {
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) return -1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index + 2);
      if (index === -1) return -1;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      for (index += 1; index < source.length; index += 1) {
        if (source[index] === "\\") index += 1;
        else if (source[index] === quote) break;
      }
      if (index >= source.length) return -1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error("unterminated block comment");
      index = end + 2;
      continue;
    }
    if (char === "`") {
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          closed = true;
          break;
        }
        if (source[index] === "$" && source[index + 1] === "{") {
          const end = findTemplateExpressionEnd(source, index + 2);
          if (end === -1) throw new Error("unterminated template expression");
          tokens.push(...tokenize(source.slice(index + 2, end)));
          index = end + 1;
          continue;
        }
        index += 1;
      }
      if (!closed) throw new Error("unterminated template literal");
      continue;
    }
    if (char === "'" && (isJsxTextApostrophe(source, index) ||
        (/[A-Za-z0-9]/.test(source[index - 1] ?? "") && /[A-Za-z0-9]/.test(source[index + 1] ?? "")))) {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        const next = source[index];
        if (next === "\n") break;
        if (next === "\\") {
          if (index + 1 >= source.length) throw new Error("unterminated string escape");
          const escaped = source[index + 1];
          value += ({ n: "\n", r: "\r", t: "\t" })[escaped] ?? escaped;
          index += 2;
          continue;
        }
        if (next === quote) {
          index += 1;
          closed = true;
          break;
        }
        value += next;
        index += 1;
      }
      if (!closed) {
        if (quote === "'") continue;
        throw new Error("unterminated string literal");
      }
      tokens.push({ type: "string", value });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push({ type: "identifier", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ type: "punctuation", value: char });
    index += 1;
  }
  return tokens;
}

function exportedStringConstants(source, path) {
  const sourceFile = typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`invalid ${path}: ${sourceFile.parseDiagnostics[0].messageText}`);
  }

  const constants = [];
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement) ||
        !statement.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword) ||
        !(statement.declarationList.flags & typescript.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!typescript.isIdentifier(declaration.name) || !declaration.initializer) continue;
      let initializer = declaration.initializer;
      while (typescript.isParenthesizedExpression(initializer) || typescript.isAsExpression(initializer) ||
             typescript.isTypeAssertionExpression(initializer) || typescript.isSatisfiesExpression(initializer)) {
        initializer = initializer.expression;
      }
      if (typescript.isStringLiteral(initializer) || typescript.isNoSubstitutionTemplateLiteral(initializer)) {
        constants.push({ identifier: declaration.name.text, value: initializer.text });
      }
    }
  }
  return constants;
}

export const FLAG_DEFINITIONS_DIRECTORY = "src/lib/flags/definitions/";

export function flagDefinitionPaths(ref) {
  return git(["ls-tree", "-r", "--name-only", ref, FLAG_DEFINITIONS_DIRECTORY])
    .split("\n").filter(Boolean).sort();
}

// Parse data, never execute PR modules in trusted checks or during generation.
export function parseFlagFile(source, path) {
  const file = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true);
  const fail = (message) => { throw new Error(`invalid ${path}: ${message}`); };
  if (file.parseDiagnostics.length) fail("TypeScript syntax error");
  const statements = file.statements.filter((statement) =>
    !(typescript.isImportDeclaration(statement) && statement.importClause?.isTypeOnly));
  if (statements.length !== 2) fail("use one exported key const and one default definition, with type-only imports at most");
  const [binding, exported] = statements;
  if (!typescript.isVariableStatement(binding) ||
      !(binding.declarationList.flags & typescript.NodeFlags.Const) ||
      !binding.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword) ||
      binding.modifiers.length !== 1 || binding.declarationList.declarations.length !== 1) fail("expected one exported key const");
  const declaration = binding.declarationList.declarations[0];
  const key = unwrapExpr(declaration.initializer);
  if (!typescript.isIdentifier(declaration.name) || !key || !typescript.isStringLiteral(key) ||
      !/^(?:htpr|hyfa|yper4)-\d+-[a-z0-9-]+$/.test(key.text)) fail("key must be a literal ticket-specific flag key");
  if (path.split("/").at(-1) !== `${key.text}.ts`) fail("filename must match the flag key");
  if (!typescript.isExportAssignment(exported) || exported.isExportEquals) fail("expected a default definition object");
  const object = unwrapExpr(exported.expression);
  if (!object || !typescript.isObjectLiteralExpression(object)) fail("definition must be an object literal");
  const allowed = new Set(["key", "kind", "defaultMode", "shippedOn", "description", "related", "releaseRisk"]);
  const fields = new Map();
  for (const property of object.properties) {
    if (!typescript.isPropertyAssignment(property) ||
        !(typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name))) fail("literal properties only, without spreads");
    const name = property.name.text;
    if (!allowed.has(name) || fields.has(name)) fail(`unknown or duplicate field ${name}`);
    fields.set(name, unwrapExpr(property.initializer));
  }
  const keyField = fields.get("key");
  if (!keyField || !typescript.isIdentifier(keyField) || keyField.text !== declaration.name.text) fail("definition key must use its exported constant");
  const definition = { key: key.text };
  for (const name of ["kind", "defaultMode", "shippedOn", "description"]) {
    const value = fields.get(name);
    if (!value) {
      if (["shippedOn", "description"].includes(name)) fail(`missing ${name}`);
      continue;
    }
    if (!typescript.isStringLiteral(value)) fail(`${name} must be a string literal`);
    definition[name] = value.text;
  }
  if (definition.kind && !["feature", "bugfix", "improvement"].includes(definition.kind)) fail("kind must be feature, bugfix or improvement");
  if (definition.defaultMode && !["OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"].includes(definition.defaultMode)) fail("invalid defaultMode");
  if (definition.defaultMode === "EVERYONE" && definition.kind !== "bugfix") fail("only bugfix flags may default to Everyone");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(definition.shippedOn) || !Number.isFinite(Date.parse(definition.shippedOn)) ||
      new Date(definition.shippedOn).toISOString().slice(0, 10) !== definition.shippedOn) fail("shippedOn must be a calendar date");
  if (!definition.description.trim()) fail("description must not be empty");
  if (fields.has("related")) {
    const related = fields.get("related");
    if (!typescript.isArrayLiteralExpression(related) || related.elements.some((entry) => !typescript.isStringLiteral(entry))) fail("related must be literal flag keys");
    definition.related = related.elements.map((entry) => entry.text);
  }
  if (fields.has("releaseRisk")) {
    const risk = fields.get("releaseRisk");
    if (!typescript.isObjectLiteralExpression(risk) || risk.properties.length !== 2 || risk.properties.some((entry) =>
      !typescript.isPropertyAssignment(entry) || !(typescript.isIdentifier(entry.name) || typescript.isStringLiteral(entry.name)))) fail("releaseRisk needs literal risk and reason fields");
    const values = new Map(risk.properties.map((entry) => [entry.name.text, unwrapExpr(entry.initializer)]));
    const level = values.get("risk"), reason = values.get("reason");
    if (!level || !typescript.isStringLiteral(level) || !["none", "small", "new"].includes(level.text) ||
        !reason || !typescript.isStringLiteral(reason) || !reason.text.trim() || /[\r\n\u2014]/.test(reason.text)) fail("releaseRisk needs risk none, small or new and a nonempty one-line reason");
    definition.releaseRisk = { risk: level.text, reason: reason.text };
  }
  return { identifier: declaration.name.text, definition, path };
}

export function parseFlagFiles(paths, read) {
  if (!paths.length) throw new Error("feature flag definitions folder is empty or missing");
  const rows = paths.map((path) => parseFlagFile(read(path), path));
  if (new Set(rows.map((row) => row.identifier)).size !== rows.length ||
      new Set(rows.map((row) => row.definition.key)).size !== rows.length) throw new Error("duplicate feature flag key or export");
  return rows;
}

function flagFilesAt(ref) {
  return parseFlagFiles(flagDefinitionPaths(ref), (path) => git(["show", `${ref}:${path}`]));
}

export function assertAddedFlagReleaseRisks(ref, keys) {
  const path = "src/lib/flags/releaseRisk.ts";
  let source;
  try {
    source = git(["show", `${ref}:${path}`]);
  } catch {
    throw new Error(`Add ${keys[0]} to FEATURE_FLAG_RELEASE_RISKS in ${path}.`);
  }
  const cutoff = exportedStringConstants(source, path)
    .find(({ identifier }) => identifier === "RELEASE_RISK_REQUIRED_FROM")?.value;
  if (!cutoff || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
    throw new Error(`RELEASE_RISK_REQUIRED_FROM must be an exported date string in ${path}.`);
  }
  const { shippedOn } = parseDefinitions(ref);
  keys = keys.filter((key) => !shippedOn.get(key) || shippedOn.get(key) >= cutoff);
  if (!keys.length) return;
  if (flagDefinitionPaths(ref).length) {
    const rows = flagFilesAt(ref);
    for (const key of keys) {
      if (!rows.find((row) => row.definition.key === key)?.definition.releaseRisk) {
        throw new Error(`Add releaseRisk with risk and reason to ${FLAG_DEFINITIONS_DIRECTORY}${key}.ts.`);
      }
    }
    return;
  }
  const file = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) throw new Error(`invalid ${path}`);
  const bindings = file.statements.filter(typescript.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations.map((declaration) => ({ statement, declaration })))
    .filter(({ declaration }) => typescript.isIdentifier(declaration.name) && declaration.name.text === "FEATURE_FLAG_RELEASE_RISKS");
  const binding = bindings[0];
  if (bindings.length !== 1 || !(binding.statement.declarationList.flags & typescript.NodeFlags.Const) ||
      !binding.statement.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword)) {
    throw new Error("FEATURE_FLAG_RELEASE_RISKS must be one exported const.");
  }
  assertPolicyBindingImmutable(file, "FEATURE_FLAG_RELEASE_RISKS", binding.declaration);
  const entries = unwrapExpr(binding.declaration.initializer);
  if (!entries || !typescript.isObjectLiteralExpression(entries)) {
    throw new Error("FEATURE_FLAG_RELEASE_RISKS must be an object literal.");
  }
  if (entries.properties.some((entry) => !typescript.isPropertyAssignment(entry) ||
      !typescript.isStringLiteral(entry.name))) {
    throw new Error("Release-risk entries must use literal flag keys, without spreads.");
  }
  for (const key of keys) {
    const matches = entries.properties.filter((entry) => entry.name.text === key);
    if (matches.length !== 1) throw new Error(`Add ${key} to FEATURE_FLAG_RELEASE_RISKS in ${path} with one release-risk entry.`);
    const value = unwrapExpr(matches[0].initializer);
    if (!typescript.isObjectLiteralExpression(value) || value.properties.length !== 2 ||
        value.properties.some((entry) => !typescript.isPropertyAssignment(entry))) {
      throw new Error(`Release risk for ${key} needs literal risk and reason fields.`);
    }
    const fields = new Map(value.properties.map((entry) => [entry.name.getText(file).replace(/["']/g, ""), unwrapExpr(entry.initializer)]));
    const risk = fields.get("risk");
    const reason = fields.get("reason");
    if (!risk || !typescript.isStringLiteral(risk) || !["none", "small", "new"].includes(risk.text) ||
        !reason || !typescript.isStringLiteral(reason) || !reason.text.trim() || /[\r\n\u2014]/.test(reason.text)) {
      throw new Error(`Release risk for ${key} needs risk none, small or new and a nonempty one-line reason.`);
    }
  }
}

export function parseFlagRegistry(ref) {
  if (flagDefinitionPaths(ref).length) {
    const rows = flagFilesAt(ref);
    return {
      byIdentifier: new Map(rows.map(({ identifier, definition }) => [identifier, definition.key])),
      byValue: new Map(rows.map(({ identifier, definition }) => [definition.key, identifier])),
    };
  }
  const path = "src/lib/flags/keys.ts";
  const source = git(["show", `${ref}:${path}`]);
  const byIdentifier = new Map();
  const byValue = new Map();
  for (const { identifier, value } of exportedStringConstants(source, path)) {
    if (byIdentifier.has(identifier) || byValue.has(value)) {
      throw new Error(`duplicate feature flag key ${identifier}`);
    }
    byIdentifier.set(identifier, value);
    byValue.set(value, identifier);
  }
  if (byIdentifier.size === 0) throw new Error("feature flag key registry is empty");
  return { byIdentifier, byValue };
}

function resolveImportedStringConstant(ref, imports, localName) {
  const specifier = imports.flatMap((declaration) =>
    declaration.specifiers.map((entry) => ({ ...entry, module: declaration.module })),
  ).find((entry) => entry.local === localName);
  if (!specifier || !specifier.module.startsWith("@/") || specifier.module.includes("..")) {
    throw new Error(`unknown feature flag key constant ${localName}`);
  }

  const modulePath = `src/${specifier.module.slice(2)}.ts`;
  const source = git(["show", `${ref}:${modulePath}`]);
  const resolved = exportedStringConstants(source, modulePath)
    .find(({ identifier }) => identifier === specifier.imported);
  if (resolved) return resolved.value;
  throw new Error(`feature flag key ${localName} is not an exported string constant`);
}

const ASSIGNMENT_OPERATORS = new Set([
  typescript.SyntaxKind.EqualsToken,
  typescript.SyntaxKind.PlusEqualsToken,
  typescript.SyntaxKind.MinusEqualsToken,
  typescript.SyntaxKind.AsteriskEqualsToken,
  typescript.SyntaxKind.AsteriskAsteriskEqualsToken,
  typescript.SyntaxKind.SlashEqualsToken,
  typescript.SyntaxKind.PercentEqualsToken,
  typescript.SyntaxKind.LessThanLessThanEqualsToken,
  typescript.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  typescript.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  typescript.SyntaxKind.AmpersandEqualsToken,
  typescript.SyntaxKind.BarEqualsToken,
  typescript.SyntaxKind.CaretEqualsToken,
  typescript.SyntaxKind.BarBarEqualsToken,
  typescript.SyntaxKind.AmpersandAmpersandEqualsToken,
  typescript.SyntaxKind.QuestionQuestionEqualsToken,
]);
const MUTATING_ARRAY_METHODS = new Set([
  "copyWithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift",
]);

export function unwrapExpr(node) {
  let current = node;
  while (current &&
         (typescript.isParenthesizedExpression(current) ||
          typescript.isAsExpression(current) ||
          typescript.isTypeAssertionExpression(current) ||
          typescript.isSatisfiesExpression(current) ||
          typescript.isNonNullExpression(current))) {
    current = current.expression;
  }
  return current;
}

const SAFE_DEFINITION_FIELDS = new Set(["key"]);

function bindingElementFieldName(element) {
  if (element.propertyName && typescript.isIdentifier(element.propertyName)) return element.propertyName.text;
  if (!element.propertyName && typescript.isIdentifier(element.name)) return element.name.text;
  return null;
}

function bindingPatternRejectsElementAlias(pattern) {
  if (typescript.isObjectBindingPattern(pattern)) {
    return pattern.elements.every((element) => {
      if (!typescript.isBindingElement(element) || element.dotDotDotToken) return false;
      const field = bindingElementFieldName(element);
      if (!field || !SAFE_DEFINITION_FIELDS.has(field)) return false;
      return typescript.isIdentifier(element.name);
    });
  }
  return false;
}

function isSafeDefinitionsCallback(callback) {
  // Regular function expressions expose `arguments[0]` even with destructured
  // parameters, so only arrow callbacks can be treated as safe reads.
  // Block bodies can still mutate via outer aliases; expression bodies cannot.
  if (!callback ||
      !typescript.isArrowFunction(callback) ||
      typescript.isBlock(callback.body) ||
      callback.parameters.length >= 3 ||
      callback.parameters.some((parameter) => parameter.dotDotDotToken)) {
    return false;
  }
  return callback.parameters.every((parameter) =>
    (typescript.isObjectBindingPattern(parameter.name) || typescript.isArrayBindingPattern(parameter.name)) &&
    bindingPatternRejectsElementAlias(parameter.name),
  );
}

function isAssignmentPatternTarget(node) {
  // Walk assignment targets, including destructuring in for-in/of initializers.
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (typescript.isBinaryExpression(parent) && parent.left === current &&
        ASSIGNMENT_OPERATORS.has(parent.operatorToken.kind)) {
      return true;
    }
    if ((typescript.isForOfStatement(parent) || typescript.isForInStatement(parent)) &&
        parent.initializer === current) return true;
    if ((typescript.isPropertyAssignment(parent) && parent.initializer === current) ||
        (typescript.isShorthandPropertyAssignment(parent) && parent.name === current) ||
        (typescript.isSpreadAssignment(parent) && parent.expression === current) ||
        (typescript.isSpreadElement(parent) && parent.expression === current) ||
        typescript.isObjectLiteralExpression(parent) ||
        typescript.isArrayLiteralExpression(parent) ||
        (typescript.isParenthesizedExpression(parent) && parent.expression === current) ||
        (typescript.isAsExpression(parent) && parent.expression === current) ||
        (typescript.isTypeAssertionExpression(parent) && parent.expression === current) ||
        (typescript.isSatisfiesExpression(parent) && parent.expression === current) ||
        (typescript.isNonNullExpression(parent) && parent.expression === current)) {
      current = parent;
      continue;
    }
    break;
  }
  return false;
}

function isEscapingAliasUse(target) {
  const parent = target.parent;
  if (!parent) return false;
  if (typescript.isReturnStatement(parent) && parent.expression === target) return true;
  if (typescript.isThrowStatement(parent) && parent.expression === target) return true;
  if (typescript.isYieldExpression(parent) && parent.expression === target) return true;
  if (typescript.isSpreadElement(parent) && parent.expression === target) return true;
  if (typescript.isArrayLiteralExpression(parent)) return true;
  if (typescript.isShorthandPropertyAssignment(parent) && parent.name === target) return true;
  if (typescript.isPropertyAssignment(parent) && parent.initializer === target) return true;
  if (typescript.isSpreadAssignment(parent) && parent.expression === target) return true;
  if (typescript.isJsxExpression(parent) && parent.expression === target) return true;
  return isAssignmentPatternTarget(target);
}

export function isBindingWrite(target) {
  const parent = target.parent;
  if (!parent) return false;
  if ((typescript.isPrefixUnaryExpression(parent) || typescript.isPostfixUnaryExpression(parent)) &&
      parent.operand === target &&
      (parent.operator === typescript.SyntaxKind.PlusPlusToken ||
       parent.operator === typescript.SyntaxKind.MinusMinusToken)) {
    return true;
  }
  if (typescript.isBinaryExpression(parent) && parent.left === target &&
      ASSIGNMENT_OPERATORS.has(parent.operatorToken.kind)) {
    return true;
  }
  if (typescript.isDeleteExpression(parent) && parent.expression === target) return true;
  return isAssignmentPatternTarget(target);
}

function isMutatingUse(target) {
  if (isBindingWrite(target)) return true;
  const parent = target.parent;
  if (!parent) return false;
  if (typescript.isVariableDeclaration(parent) && parent.initializer === target) return true;
  if ((typescript.isCallExpression(parent) || typescript.isNewExpression(parent)) &&
      parent.arguments?.includes(target)) {
    return true;
  }
  if (typescript.isCallExpression(parent) && parent.expression === target &&
      typescript.isPropertyAccessExpression(target) &&
      MUTATING_ARRAY_METHODS.has(target.name.text)) {
    return true;
  }
  if (isEscapingAliasUse(target)) return true;
  return false;
}

function assertPolicyBindingImmutable(sourceFile, name, declaration) {
  let mutation = null;
  const elementAliases = new Set();

  function mark(node) {
    if (!mutation) mutation = node;
  }

  function visitPolicyName(node) {
    if (mutation) return;
    if (!(typescript.isIdentifier(node) && node.text === name && node !== declaration.name) ||
        (typescript.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
        (typescript.isPropertyAssignment(node.parent) && node.parent.name === node) ||
        (typescript.isImportSpecifier(node.parent) && node.parent.name === node && !node.parent.propertyName)) {
      return;
    }

    let target = node;
    while (target.parent &&
           ((typescript.isParenthesizedExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isAsExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isTypeAssertionExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isSatisfiesExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isNonNullExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isPropertyAccessExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isElementAccessExpression(target.parent) && target.parent.expression === target))) {
      target = target.parent;
    }

    // Copying a literal string cannot expose a mutable alias to its const binding.
    // Keep assignment detection, including destructuring, but allow normal reads.
    if ((name === "DEFAULT_FEATURE_FLAG_MODE" || name === "DEFAULT_BUGFIX_FLAG_MODE") &&
        typescript.isStringLiteral(unwrapExpr(declaration.initializer))) {
      if (isBindingWrite(target)) mark(target);
      return;
    }

    const parent = target.parent;
    const methodCall = parent && typescript.isCallExpression(parent) && parent.expression === target &&
      typescript.isPropertyAccessExpression(target);
    const methodName = methodCall ? target.name.text : null;
    const callback = methodCall ? parent.arguments[0] : null;
    const safeDefinitionsRead = name === "FEATURE_FLAG_DEFINITIONS" && methodCall &&
      (methodName === "map" || methodName === "find") && isSafeDefinitionsCallback(callback);

    if (safeDefinitionsRead) {
      // find returns a definition object; map with destructuring returns new values.
      // Track find results (and any further aliases) so callback/result mutation still fails closed.
      if (methodName === "find") {
        let result = parent;
        while (result.parent &&
               ((typescript.isParenthesizedExpression(result.parent) && result.parent.expression === result) ||
                (typescript.isAsExpression(result.parent) && result.parent.expression === result) ||
                (typescript.isTypeAssertionExpression(result.parent) && result.parent.expression === result) ||
                (typescript.isSatisfiesExpression(result.parent) && result.parent.expression === result) ||
                (typescript.isNonNullExpression(result.parent) && result.parent.expression === result))) {
          result = result.parent;
        }
        const resultParent = result.parent;
        if (resultParent && typescript.isVariableDeclaration(resultParent) &&
            resultParent.initializer === result && typescript.isIdentifier(resultParent.name)) {
          elementAliases.add(resultParent.name.text);
        } else if (resultParent && typescript.isBinaryExpression(resultParent) &&
                   resultParent.right === result &&
                   resultParent.operatorToken.kind === typescript.SyntaxKind.EqualsToken) {
          const left = unwrapExpr(resultParent.left);
          if (typescript.isIdentifier(left)) elementAliases.add(left.text);
          else mark(result);
        } else if (resultParent &&
                   ((typescript.isPropertyAccessExpression(resultParent) && resultParent.expression === result) ||
                    (typescript.isElementAccessExpression(resultParent) && resultParent.expression === result))) {
          // Climb nested reads so find()?.a.b = ... and find()?.mutate() still fail closed.
          let access = resultParent;
          while (access.parent &&
                 ((typescript.isPropertyAccessExpression(access.parent) && access.parent.expression === access) ||
                  (typescript.isElementAccessExpression(access.parent) && access.parent.expression === access) ||
                  (typescript.isNonNullExpression(access.parent) && access.parent.expression === access) ||
                  (typescript.isParenthesizedExpression(access.parent) && access.parent.expression === access) ||
                  (typescript.isAsExpression(access.parent) && access.parent.expression === access) ||
                  (typescript.isTypeAssertionExpression(access.parent) && access.parent.expression === access) ||
                  (typescript.isSatisfiesExpression(access.parent) && access.parent.expression === access))) {
            access = access.parent;
          }
          if (access.parent && typescript.isCallExpression(access.parent) && access.parent.expression === access) {
            mark(access);
          } else if (isMutatingUse(access)) {
            mark(access);
          }
        } else {
          // Returning, spreading, or nesting the find result escapes the object.
          mark(result);
        }
      }
      return;
    }

    if (isMutatingUse(target) || (name === "FEATURE_FLAG_DEFINITIONS" && !safeDefinitionsRead)) {
      mark(target);
    }
  }

  function visitAlias(node) {
    if (mutation || !typescript.isIdentifier(node) || !elementAliases.has(node.text)) return;
    if ((typescript.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
        (typescript.isPropertyAssignment(node.parent) && node.parent.name === node) ||
        (typescript.isVariableDeclaration(node.parent) && node.parent.name === node)) {
      return;
    }

    let target = node;
    while (target.parent &&
           ((typescript.isParenthesizedExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isAsExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isTypeAssertionExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isSatisfiesExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isNonNullExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isPropertyAccessExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isElementAccessExpression(target.parent) && target.parent.expression === target) ||
            (typescript.isPropertyAccessExpression(target.parent) &&
             target.parent.questionDotToken && target.parent.expression === target))) {
      target = target.parent;
    }

    const parent = target.parent;
    if (parent && typescript.isVariableDeclaration(parent) && parent.initializer === target &&
        typescript.isIdentifier(parent.name)) {
      elementAliases.add(parent.name.text);
      return;
    }
    if (parent && typescript.isBinaryExpression(parent) && parent.right === target &&
        parent.operatorToken.kind === typescript.SyntaxKind.EqualsToken) {
      const left = unwrapExpr(parent.left);
      if (typescript.isIdentifier(left)) {
        elementAliases.add(left.text);
        return;
      }
      mark(target);
      return;
    }
    // Any method call on a definition object can mutate it; do not limit this to array mutators.
    if (parent && typescript.isCallExpression(parent) && parent.expression === target) {
      mark(target);
      return;
    }
    if (isMutatingUse(target)) mark(target);
  }

  function visit(node) {
    visitPolicyName(node);
    visitAlias(node);
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (mutation) throw new Error(`${name} must not be reassigned, aliased, or mutated`);
}

export function parseDefinitions(ref) {
  const paths = ["src/lib/flags.ts"];
  const definitionsPath = "src/lib/flags/definitions.ts";
  if (git(["ls-tree", "--name-only", ref, definitionsPath]).trim()) paths.push(definitionsPath);
  const sourceFiles = paths.map((path) => {
    const sourceFile = typescript.createSourceFile(
      path,
      git(["show", `${ref}:${path}`]),
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    if (sourceFile.parseDiagnostics.length > 0) {
      throw new Error(`invalid ${path}: ${sourceFile.parseDiagnostics[0].messageText}`);
    }
    return sourceFile;
  });

  const declarations = new Map();
  for (const sourceFile of sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!typescript.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!typescript.isIdentifier(declaration.name)) continue;
        if (declarations.has(declaration.name.text)) {
          throw new Error(`duplicate ${declaration.name.text} declaration`);
        }
        declarations.set(declaration.name.text, {
          declaration,
          sourceFile,
          isConst: Boolean(statement.declarationList.flags & typescript.NodeFlags.Const),
        });
      }
    }
  }

  const definitionsBinding = declarations.get("FEATURE_FLAG_DEFINITIONS");
  const modeBinding = declarations.get("DEFAULT_FEATURE_FLAG_MODE");
  if (!definitionsBinding?.isConst) throw new Error("FEATURE_FLAG_DEFINITIONS must be declared const");
  if (!modeBinding?.isConst) throw new Error("DEFAULT_FEATURE_FLAG_MODE must be declared const");
  const perFlagPaths = flagDefinitionPaths(ref);
  const perFlagRows = perFlagPaths.length ? flagFilesAt(ref) : null;
  const imports = parseImports(definitionsBinding.sourceFile.text);
  for (const sourceFile of sourceFiles) {
    assertPolicyBindingImmutable(sourceFile, "FEATURE_FLAG_DEFINITIONS", definitionsBinding.declaration);
    assertPolicyBindingImmutable(sourceFile, "DEFAULT_FEATURE_FLAG_MODE", modeBinding.declaration);
  }

  let definitions = definitionsBinding.declaration.initializer;
  while (definitions && (typescript.isParenthesizedExpression(definitions) ||
         typescript.isAsExpression(definitions) || typescript.isTypeAssertionExpression(definitions) ||
         typescript.isSatisfiesExpression(definitions))) definitions = definitions.expression;
  if (perFlagRows) {
    if (!typescript.isIdentifier(definitions) || definitions.text !== "FLAG_DEFINITIONS" ||
        !definitionsBinding.sourceFile.statements.some((statement) => typescript.isImportDeclaration(statement) &&
          statement.moduleSpecifier.text === "./definitions/index.generated" &&
          statement.importClause?.namedBindings?.elements?.some((entry) => entry.name.text === "FLAG_DEFINITIONS" && !entry.propertyName))) {
      throw new Error("FEATURE_FLAG_DEFINITIONS must use FLAG_DEFINITIONS from the generated index");
    }
    const wrapper = definitionsBinding.sourceFile;
    if (wrapper.fileName !== definitionsPath || wrapper.statements.some((statement) => {
      if (typescript.isTypeAliasDeclaration(statement) || typescript.isInterfaceDeclaration(statement)) return false;
      if (typescript.isImportDeclaration(statement)) {
        if (statement.importClause?.isTypeOnly) return false;
        const bindings = statement.importClause?.namedBindings;
        return statement.moduleSpecifier.text !== "./definitions/index.generated" || statement.importClause?.name ||
          !bindings || !typescript.isNamedImports(bindings) || bindings.elements.length !== 1 ||
          bindings.elements[0].name.text !== "FLAG_DEFINITIONS" || bindings.elements[0].propertyName;
      }
      return !typescript.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1 ||
        statement.declarationList.declarations[0] !== definitionsBinding.declaration;
    })) {
      throw new Error("FEATURE_FLAG_DEFINITIONS must use the data-only generated registry wrapper, without runtime mutations or aliases");
    }
  } else if (!definitions || !typescript.isArrayLiteralExpression(definitions)) {
    throw new Error("FEATURE_FLAG_DEFINITIONS must be an array literal");
  }

  const kinds = [];
  const shippedOn = [];
  const keys = perFlagRows ? perFlagRows.map(({ definition }) => {
    kinds.push(definition.kind ?? "feature");
    shippedOn.push(definition.shippedOn);
    return definition.key;
  }) : definitions.elements.map((element) => {
    if (!typescript.isObjectLiteralExpression(element)) {
      throw new Error("feature flag definitions must be direct object literals");
    }
    if (element.properties.some(typescript.isSpreadAssignment)) {
      throw new Error("feature flag definitions cannot contain object spreads");
    }
    if (element.properties.some((property) => property.name && typescript.isComputedPropertyName(property.name))) {
      throw new Error("feature flag definitions cannot contain computed property names");
    }
    const keyProperties = element.properties.filter((property) =>
      property.name &&
      ((typescript.isIdentifier(property.name) && property.name.text === "key") ||
       (typescript.isStringLiteral(property.name) && property.name.text === "key")),
    );
    if (keyProperties.length !== 1) {
      throw new Error(`feature flag definition has ${keyProperties.length === 0 ? "no" : "duplicate"} key fields`);
    }
    if (!typescript.isPropertyAssignment(keyProperties[0])) {
      throw new Error("feature flag definition key must be a property assignment");
    }

    const kindProperties = element.properties.filter((property) =>
      property.name &&
      ((typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name)) &&
       property.name.text === "kind"));
    if (kindProperties.length > 1 ||
        (kindProperties.length === 1 && !typescript.isPropertyAssignment(kindProperties[0]))) {
      throw new Error("feature flag kind must be one literal property assignment");
    }
    const kind = kindProperties.length ? unwrapExpr(kindProperties[0].initializer) : null;
    if (kind && (!typescript.isStringLiteral(kind) ||
        !["feature", "bugfix", "improvement"].includes(kind.text))) {
      throw new Error("feature flag kind must be feature, bugfix or improvement");
    }
    kinds.push(kind?.text ?? "feature");

    const shippedOnProperties = element.properties.filter((property) =>
      property.name &&
      ((typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name)) &&
       property.name.text === "shippedOn"));
    const date = shippedOnProperties.length === 1 && typescript.isPropertyAssignment(shippedOnProperties[0])
      ? unwrapExpr(shippedOnProperties[0].initializer) : null;
    shippedOn.push(date && typescript.isStringLiteral(date) && /^\d{4}-\d{2}-\d{2}$/.test(date.text) &&
      Number.isFinite(Date.parse(date.text)) && new Date(date.text).toISOString().slice(0, 10) === date.text
      ? date.text : null);

    let value = keyProperties[0].initializer;
    while (typescript.isParenthesizedExpression(value) || typescript.isAsExpression(value) ||
           typescript.isTypeAssertionExpression(value) || typescript.isSatisfiesExpression(value)) {
      value = value.expression;
    }
    if (typescript.isStringLiteral(value) || typescript.isNoSubstitutionTemplateLiteral(value)) return value.text;
    if (typescript.isIdentifier(value)) {
      return resolveImportedStringConstant(ref, imports, value.text);
    }
    throw new Error("feature flag definition key must be a string or key constant");
  });
  if (new Set(keys).size !== keys.length) throw new Error("duplicate FEATURE_FLAG_DEFINITIONS key");

  let mode = modeBinding.declaration.initializer;
  while (mode && (typescript.isParenthesizedExpression(mode) || typescript.isAsExpression(mode) ||
         typescript.isTypeAssertionExpression(mode) || typescript.isSatisfiesExpression(mode))) {
    mode = mode.expression;
  }
  if (!mode || !typescript.isStringLiteral(mode)) {
    throw new Error("DEFAULT_FEATURE_FLAG_MODE must be a string literal");
  }
  if (mode.text !== "OWNER_AND_QA") throw new Error("Feature flags must default to Owner + QA.");
  const bugfixModeBinding = declarations.get("DEFAULT_BUGFIX_FLAG_MODE");
  if (bugfixModeBinding || kinds.includes("bugfix")) {
    if (!bugfixModeBinding?.isConst) throw new Error("DEFAULT_BUGFIX_FLAG_MODE must be declared const");
    for (const sourceFile of sourceFiles) {
      assertPolicyBindingImmutable(sourceFile, "DEFAULT_BUGFIX_FLAG_MODE", bugfixModeBinding.declaration);
    }
    const bugfixMode = unwrapExpr(bugfixModeBinding.declaration.initializer);
    if (!bugfixMode || !typescript.isStringLiteral(bugfixMode) || bugfixMode.text !== "EVERYONE") {
      throw new Error("Bugfix flags must default to Everyone.");
    }
  }
  return { keys, shippedOn: new Map(keys.map((key, index) => [key, shippedOn[index]])) };
}

function parseImports(source) {
  const tokens = tokenize(source);
  const imports = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "import") continue;
    let cursor = index + 1;
    // Skip `import type ...` marker when present before the clause.
    if (tokens[cursor]?.value === "type") cursor += 1;
    // Skip a default binding so `import Default, { FLAG } from "..."` still works.
    if (tokens[cursor]?.type === "identifier") {
      cursor += 1;
      if (tokens[cursor]?.value === ",") cursor += 1;
    }
    if (tokens[cursor]?.value !== "{") continue;
    const specifiers = [];
    cursor += 1;
    while (cursor < tokens.length && tokens[cursor].value !== "}") {
      if (tokens[cursor].value === "type" || tokens[cursor].value === ",") {
        cursor += 1;
        continue;
      }
      if (tokens[cursor].type !== "identifier") throw new Error("unsupported named import syntax");
      const imported = tokens[cursor].value;
      let local = imported;
      if (tokens[cursor + 1]?.value === "as") {
        if (tokens[cursor + 2]?.type !== "identifier") throw new Error("unsupported import alias");
        local = tokens[cursor + 2].value;
        cursor += 2;
      }
      specifiers.push({ imported, local });
      cursor += 1;
    }
    if (tokens[cursor]?.value !== "}" || tokens[cursor + 1]?.value !== "from" || tokens[cursor + 2]?.type !== "string") {
      throw new Error("unsupported named import declaration");
    }
    imports.push({ module: tokens[cursor + 2].value, specifiers });
    index = cursor + 2;
  }
  return imports;
}
