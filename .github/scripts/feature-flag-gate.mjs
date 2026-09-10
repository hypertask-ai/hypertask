import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const typescript = require(process.env.FEATURE_FLAG_TYPESCRIPT_PATH || "typescript");

const EXEMPT_TAGS = new Set(["BUGFIX", "INFRA"]);
const CROSS_CHECK_LINE_BUDGET = 150;
const FLAG_KEY_MODULES = new Set(["@/lib/flags", "@/lib/flags/keys"]);
const UI_INCLUDE = [
  /^src\/components\//,
  /^src\/pages\/(?!api\/)/,
  /^src\/app\//,
  /\.(jsx|tsx|css)$/,
];
const UI_EXCLUDE = [
  /^src\/pages\/api\//,
  /^src\/app\/api\//,
  /^src\/app\/(?:.*\/)?route\.[jt]sx?$/,
  /^src\/lib\//,
  /(^|\/)tests?\//,
  /\.(test|spec)\.[jt]sx?$/,
  /\.stories\.[jt]sx?$/,
  /(^|\/)docs\//,
  /\.md$/,
];

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isUiFile(path) {
  return !UI_EXCLUDE.some((pattern) => pattern.test(path)) &&
    UI_INCLUDE.some((pattern) => pattern.test(path));
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

function parseFlagRegistry(ref) {
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

function parseDefinitions(ref) {
  const source = git(["show", `${ref}:src/lib/flags.ts`]);
  const imports = parseImports(source);
  const sourceFile = typescript.createSourceFile(
    "src/lib/flags.ts",
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`invalid src/lib/flags.ts: ${sourceFile.parseDiagnostics[0].messageText}`);
  }

  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!typescript.isIdentifier(declaration.name)) continue;
      if (declarations.has(declaration.name.text)) {
        throw new Error(`duplicate ${declaration.name.text} declaration`);
      }
      declarations.set(declaration.name.text, declaration);
    }
  }

  let definitions = declarations.get("FEATURE_FLAG_DEFINITIONS")?.initializer;
  while (definitions && (typescript.isParenthesizedExpression(definitions) ||
         typescript.isAsExpression(definitions) || typescript.isTypeAssertionExpression(definitions) ||
         typescript.isSatisfiesExpression(definitions))) definitions = definitions.expression;
  if (!definitions || !typescript.isArrayLiteralExpression(definitions)) {
    throw new Error("FEATURE_FLAG_DEFINITIONS must be an array literal");
  }

  const keys = definitions.elements.map((element) => {
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

  let mode = declarations.get("DEFAULT_FEATURE_FLAG_MODE")?.initializer;
  while (mode && (typescript.isParenthesizedExpression(mode) || typescript.isAsExpression(mode) ||
         typescript.isTypeAssertionExpression(mode) || typescript.isSatisfiesExpression(mode))) {
    mode = mode.expression;
  }
  if (!mode || !typescript.isStringLiteral(mode)) {
    throw new Error("DEFAULT_FEATURE_FLAG_MODE must be a string literal");
  }
  return { keys, defaultMode: mode.text };
}

function parseImports(source) {
  const tokens = tokenize(source);
  const imports = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "import" || tokens[index + 1]?.value !== "{") continue;
    const specifiers = [];
    index += 2;
    while (index < tokens.length && tokens[index].value !== "}") {
      if (tokens[index].value === "type" || tokens[index].value === ",") {
        index += 1;
        continue;
      }
      if (tokens[index].type !== "identifier") throw new Error("unsupported named import syntax");
      const imported = tokens[index].value;
      let local = imported;
      if (tokens[index + 1]?.value === "as") {
        if (tokens[index + 2]?.type !== "identifier") throw new Error("unsupported import alias");
        local = tokens[index + 2].value;
        index += 2;
      }
      specifiers.push({ imported, local });
      index += 1;
    }
    if (tokens[index]?.value !== "}" || tokens[index + 1]?.value !== "from" || tokens[index + 2]?.type !== "string") {
      throw new Error("unsupported named import declaration");
    }
    imports.push({ module: tokens[index + 2].value, specifiers });
  }
  return imports;
}

function staticBoolean(node) {
  while (typescript.isParenthesizedExpression(node) || typescript.isAsExpression(node) ||
         typescript.isTypeAssertionExpression(node) || typescript.isNonNullExpression(node) ||
         typescript.isSatisfiesExpression(node)) node = node.expression;
  if (node.kind === typescript.SyntaxKind.TrueKeyword) return true;
  if (node.kind === typescript.SyntaxKind.FalseKeyword) return false;
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
      controlsOutput = true;
      continue;
    }
    if ((typescript.isConditionalExpression(parent) && child === parent.condition) ||
        (typescript.isIfStatement(parent) && child === parent.expression) ||
        (typescript.isWhileStatement(parent) && child === parent.expression) ||
        (typescript.isDoStatement(parent) && child === parent.expression) ||
        (typescript.isForStatement(parent) && child === parent.condition)) {
      controlsOutput = true;
      continue;
    }
    if (typescript.isStatement(parent) || typescript.isVariableDeclaration(parent) ||
        typescript.isFunctionLike(parent)) return controlsOutput;
  }
  return controlsOutput;
}

function gatesRuntimeBehavior(call, checker, sourceFile) {
  if (controlsRuntimeBranch(call)) return true;
  let declaration = call.parent;
  while (declaration && !typescript.isVariableDeclaration(declaration) &&
         !typescript.isStatement(declaration) && !typescript.isFunctionLike(declaration)) {
    declaration = declaration.parent;
  }
  if (!declaration || !typescript.isVariableDeclaration(declaration) ||
      !typescript.isIdentifier(declaration.name)) return false;
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol) return false;

  let usedAsGate = false;
  function visit(node) {
    if (usedAsGate) return;
    if (typescript.isIdentifier(node) && node !== declaration.name &&
        checker.getSymbolAtLocation(node) === symbol && controlsRuntimeBranch(node)) {
      usedAsGate = true;
      return;
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  return usedAsGate;
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

  for (const statement of sourceFile.statements) {
    if (!typescript.isImportDeclaration(statement) || !typescript.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !typescript.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      const symbol = checker.getSymbolAtLocation(specifier.name);
      if (!symbol) continue;
      if ((moduleName === "@/hooks/useFlag" && imported === "useFlag") ||
          (moduleName === "@/lib/flags" && imported === "isFeatureEnabled")) helperSymbols.add(symbol);
      if (FLAG_KEY_MODULES.has(moduleName) && registry.byIdentifier.has(imported)) {
        flagSymbols.set(symbol, registry.byIdentifier.get(imported));
      }
    }
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
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      if (key && allowedKeys.has(key) && addedLines.has(line) &&
          gatesRuntimeBehavior(node, checker, sourceFile)) found = key;
    }
    if (!found) typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function isVerifiedAutoRevert(title, baseSha, headSha) {
  if (!/^Revert "HTPR-\d+ \[[^\]]+\] .+"$/.test(title)) return false;
  const mergeBase = git(["merge-base", baseSha, headSha]).trim();
  if (git(["rev-list", "--count", `${mergeBase}..${headSha}`]).trim() !== "1") return false;
  const message = git(["show", "-s", "--format=%s%n%b", headSha]);
  if (message.split("\n", 1)[0] !== title) return false;
  const reverted = message.match(/This reverts commit ([0-9a-f]{40})\./)?.[1];
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

export function evaluate({ title, baseSha, headSha }) {
  const changedFiles = git(["diff", "--name-only", `${baseSha}...${headSha}`])
    .split("\n").filter(Boolean);
  const uiFiles = changedFiles.filter(isUiFile);
  const runtimeFiles = changedFiles.filter((path) =>
    /^src\//.test(path) && /\.[jt]sx?$/.test(path) &&
    !/(^|\/)tests?\//.test(path) && !/\.(test|spec)\.[jt]sx?$/.test(path) &&
    !/\.stories\.[jt]sx?$/.test(path));
  if (uiFiles.length === 0) {
    return { pass: true, reason: "No changed file matches the UI-change path filter." };
  }

  const titleMatch = title.match(/^HTPR-(\d+) \[([^\]]+)\] \S/);
  const autoRevert = isVerifiedAutoRevert(title, baseSha, headSha);
  const tag = titleMatch?.[2] ?? null;
  const exempt = autoRevert || (tag && EXEMPT_TAGS.has(tag));
  if (exempt) {
    const uiAdded = git(["diff", "--numstat", "--no-renames", `${baseSha}...${headSha}`])
      .split("\n").filter(Boolean)
      .map((line) => {
        const [added, , ...pathParts] = line.split("\t");
        return { added: added === "-" ? 0 : Number(added), path: pathParts.join("\t") };
      })
      .filter((row) => isUiFile(row.path))
      .reduce((sum, row) => sum + row.added, 0);
    if (uiAdded > CROSS_CHECK_LINE_BUDGET) {
      return failure(
        `This pull request is tagged ${autoRevert ? "as an auto-revert" : `[${tag}]`} but adds ${uiAdded} lines to UI files ` +
        `(over the ${CROSS_CHECK_LINE_BUDGET}-line budget). Retitle it as [FEATURE] and add a feature flag.`,
      );
    }
    return { pass: true, reason: `${autoRevert ? "Verified auto-revert" : `[${tag}]`} is exempt (${uiAdded} UI lines added).` };
  }
  if (!titleMatch) {
    return failure("The pull request title has no valid HTPR ticket and tag, so the feature flag requirement cannot be checked.");
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
    const ticketPrefix = `htpr-${titleMatch[1]}-`;
    if (added.length > 0) {
      if (added.some((key) => !key.startsWith(ticketPrefix))) {
        return failure(`New feature flag keys must start with ${ticketPrefix} to match this pull request.`);
      }
      if (headDefinitions.defaultMode !== "OWNER_AND_QA") {
        return failure("New feature flags must default to Owner + QA.");
      }
    }
    const ticketKeys = new Set(headDefinitions.keys.filter((key) => key.startsWith(ticketPrefix)));

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
      if (key) return { pass: true, reason: `[${tag}] calls ticket-specific feature gate ${key} in changed code in ${path}.` };
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
  const [title, baseSha, headSha] = process.argv.slice(2);
  try {
    if (!title || !baseSha || !headSha) throw new Error("title, base SHA, and head SHA are required");
    const result = evaluate({ title, baseSha, headSha });
    console.log(result.reason);
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    console.error(`Feature flag gate could not run: ${error.message}`);
    process.exitCode = 2;
  }
}
