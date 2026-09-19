import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix as pathPosix } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const typescript = require(process.env.FEATURE_FLAG_TYPESCRIPT_PATH || "typescript");

export const COMPONENT_REUSE_RULE =
  "Every PR that touches the UI must name the existing component it reuses for each new control.";

const COMPONENT_FILE = /^src\/components\/.*\.(?:js|jsx|tsx)$/;
const COMPONENT_PATH = /^src\/components\/.*\.[cm]?[jt]sx?$/;
const UI_FILE = /^(?:src\/components\/|src\/(?:app|pages|features)\/(?!api\/)).*\.(?:js|jsx|tsx)$/;
const UI_EXCLUDE = [
  /(^|\/)tests?\//,
  /(^|\/)fixtures?\//,
  /\.(?:test|spec|stories|fixture)\.[jt]sx?$/,
];
const INLINE_MENU = /(?:aria-haspopup\s*=\s*(?:["']menu["']|\{\s*["']menu["']\s*\})|role\s*=\s*(?:["']menu(?:item)?["']|\{\s*["']menu(?:item)?["']\s*\})|<(?:DropdownMenu|Menu)(?:\.|[A-Z][A-Za-z]*|\s|>))/m;

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function changedPaths(baseSha, headSha, filter) {
  return git([
    "diff",
    "--name-only",
    "--find-renames",
    "-z",
    `--diff-filter=${filter}`,
    `${baseSha}...${headSha}`,
  ]).split("\0").filter(Boolean);
}

function addedText(baseSha, headSha, path) {
  const diff = git([
    "diff",
    "--unified=0",
    "--no-ext-diff",
    `${baseSha}...${headSha}`,
    "--",
    path,
  ]);
  return diff.split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

function reuseSection(prBody) {
  const body = String(prBody ?? "");
  const heading = /^##[ \t]+Components reused[ \t]*$/im.exec(body);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const rest = body.slice(start);
  const nextHeading = /^##[ \t]+/m.exec(rest);
  return rest.slice(0, nextHeading?.index ?? rest.length)
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function declaredMappings(section) {
  if (!section) return [];
  const mappings = [];
  const reusedPattern = /^\s*-\s+`([^`\r\n]+)`\s+in\s+`(src\/[^`\r\n]+\.[cm]?[jt]sx?)`\s*->\s*`(src\/components\/[^`\r\n]+\.[cm]?[jt]sx?)`\s*$/;
  const noReusePattern = /^\s*-\s+`([^`\r\n]+)`\s+in\s+`(src\/[^`\r\n]+\.[cm]?[jt]sx?)`\s*->\s*No existing component fits:\s*`([^`\r\n]+)`\s*$/;
  for (const line of section.split("\n")) {
    const reused = reusedPattern.exec(line);
    const noReuse = noReusePattern.exec(line);
    if (reused) {
      mappings.push({ control: reused[1].trim(), source: reused[2], reused: reused[3], reason: null });
    } else if (noReuse) {
      mappings.push({ control: noReuse[1].trim(), source: noReuse[2], reused: null, reason: noReuse[3].trim() });
    }
  }
  return mappings;
}

function pathExistsOnBase(baseSha, path) {
  if (!COMPONENT_PATH.test(path) || path.includes("..") || path.includes("//")) return false;
  try {
    return git(["cat-file", "-t", `${baseSha}:${path}`]).trim() === "blob";
  } catch {
    return false;
  }
}

function isProductionUiFile(path) {
  return UI_FILE.test(path) && !UI_EXCLUDE.some((pattern) => pattern.test(path));
}

function sourceAt(headSha, path) {
  return git(["show", `${headSha}:${path}`]);
}

function withoutExtension(path) {
  return path.replace(/\.[cm]?[jt]sx?$/, "");
}

function resolveImport(sourcePath, specifier) {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return pathPosix.normalize(pathPosix.join(pathPosix.dirname(sourcePath), specifier));
  }
  return specifier.startsWith("src/") ? specifier : null;
}

function parseSource(source, sourcePath) {
  const scriptKind = sourcePath.endsWith(".tsx") ? typescript.ScriptKind.TSX
    : sourcePath.endsWith(".jsx") ? typescript.ScriptKind.JSX
      : sourcePath.endsWith(".js") ? typescript.ScriptKind.JS
        : typescript.ScriptKind.TS;
  return typescript.createSourceFile(
    sourcePath,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function checkedSource(source, sourcePath) {
  const options = {
    allowJs: true,
    checkJs: false,
    jsx: typescript.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    target: typescript.ScriptTarget.Latest,
  };
  const parsed = parseSource(source, sourcePath);
  const defaultHost = typescript.createCompilerHost(options, true);
  const host = {
    ...defaultHost,
    fileExists: (fileName) => fileName === sourcePath,
    getSourceFile: (fileName) => fileName === sourcePath ? parsed : undefined,
    readFile: (fileName) => fileName === sourcePath ? source : undefined,
  };
  const program = typescript.createProgram({ rootNames: [sourcePath], options, host });
  return {
    checker: program.getTypeChecker(),
    sourceFile: program.getSourceFile(sourcePath) ?? parsed,
  };
}

function addedLineNumbers(baseSha, headSha, path) {
  const diff = git(["diff", "--unified=0", "--no-renames", `${baseSha}...${headSha}`, "--", path]);
  const lines = new Set();
  for (const row of diff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(row);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let line = start; line < start + count; line += 1) lines.add(line);
  }
  return lines;
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function containsJsx(node) {
  let found = false;
  const visit = (child) => {
    if (typescript.isJsxElement(child) || typescript.isJsxSelfClosingElement(child) ||
        typescript.isJsxFragment(child)) {
      found = true;
      return;
    }
    if (!found) typescript.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function touchesAddedLine(node, sourceFile, addedLines) {
  const first = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const last = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  for (let line = first; line <= last; line += 1) {
    if (addedLines.has(line)) return true;
  }
  return false;
}

function controlsInFile(baseSha, headSha, sourcePath) {
  const { checker, sourceFile } = checkedSource(sourceAt(headSha, sourcePath), sourcePath);
  const addedLines = addedLineNumbers(baseSha, headSha, sourcePath);
  const definitions = new Map();
  const controls = new Map();
  const aliases = [];

  for (const statement of sourceFile.statements) {
    if (typescript.isExportDeclaration(statement) && !statement.moduleSpecifier &&
        statement.exportClause && typescript.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        aliases.push({ exported: element.name.text, local: element.propertyName?.text ?? element.name.text });
      }
      continue;
    }

    if ((typescript.isFunctionDeclaration(statement) || typescript.isClassDeclaration(statement)) &&
        containsJsx(statement)) {
      if (statement.name) definitions.set(statement.name.text, statement);
      if (hasModifier(statement, typescript.SyntaxKind.ExportKeyword)) {
        const control = statement.name?.text ??
          (hasModifier(statement, typescript.SyntaxKind.DefaultKeyword) ? "default" : null);
        if (control) controls.set(control, statement);
      }
      continue;
    }

    if (typescript.isVariableStatement(statement)) {
      const exported = hasModifier(statement, typescript.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!typescript.isIdentifier(declaration.name) || !declaration.initializer ||
            !containsJsx(declaration.initializer)) continue;
        definitions.set(declaration.name.text, declaration.initializer);
        if (exported) controls.set(declaration.name.text, declaration.initializer);
      }
      continue;
    }

    if (typescript.isExportAssignment(statement)) {
      if (typescript.isIdentifier(statement.expression)) {
        aliases.push({ exported: statement.expression.text, local: statement.expression.text });
      } else if (containsJsx(statement.expression)) {
        controls.set("default", statement.expression);
      }
    }
  }

  for (const { exported, local } of aliases) {
    const definition = definitions.get(local);
    if (definition) controls.set(exported, definition);
  }

  return new Map([...controls]
    .filter(([, node]) => touchesAddedLine(node, sourceFile, addedLines))
    .map(([name, node]) => [name, { checker, node }]));
}

function moduleMatches(sourcePath, specifier, componentPath) {
  const resolved = resolveImport(sourcePath, specifier);
  if (!resolved) return false;
  const imported = withoutExtension(resolved);
  const component = withoutExtension(componentPath);
  return imported === component || `${imported}/index` === component;
}

function bindingIdentifiers(name) {
  if (typescript.isIdentifier(name)) return [name];
  const identifiers = [];
  for (const element of name.elements) {
    if (!typescript.isOmittedExpression(element)) identifiers.push(...bindingIdentifiers(element.name));
  }
  return identifiers;
}

function importedBindings(sourceFile, sourcePath, componentPath) {
  const bindings = [];
  for (const statement of sourceFile.statements) {
    if (typescript.isImportDeclaration(statement) && statement.importClause &&
        !statement.importClause.isTypeOnly && typescript.isStringLiteralLike(statement.moduleSpecifier) &&
        moduleMatches(sourcePath, statement.moduleSpecifier.text, componentPath)) {
      if (statement.importClause.name) bindings.push(statement.importClause.name);
      const named = statement.importClause.namedBindings;
      if (named && typescript.isNamespaceImport(named)) bindings.push(named.name);
      if (named && typescript.isNamedImports(named)) {
        for (const element of named.elements) {
          if (!element.isTypeOnly) bindings.push(element.name);
        }
      }
    }

    if (!typescript.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !typescript.isCallExpression(call) || call.arguments.length !== 1 ||
          !typescript.isIdentifier(call.expression) || call.expression.text !== "require" ||
          !typescript.isStringLiteralLike(call.arguments[0]) ||
          !moduleMatches(sourcePath, call.arguments[0].text, componentPath)) continue;
      bindings.push(...bindingIdentifiers(declaration.name));
    }
  }
  return bindings;
}

function bindingUsedByControl(controlNode, binding, checker) {
  const importedSymbol = checker.getSymbolAtLocation(binding);
  if (!importedSymbol) return false;
  let used = false;
  const visit = (node) => {
    if (typescript.isIdentifier(node) && checker.getSymbolAtLocation(node) === importedSymbol) {
      let parent = node.parent;
      let typeOnly = false;
      while (parent && parent !== controlNode) {
        if (typescript.isTypeNode(parent)) {
          typeOnly = true;
          break;
        }
        parent = parent.parent;
      }
      if (!typeOnly) used = true;
    }
    if (!used) typescript.forEachChild(node, visit);
  };
  visit(controlNode);
  return used;
}

function controlUsesComponent(sourcePath, componentPath, control) {
  const sourceFile = control.node.getSourceFile();
  return importedBindings(sourceFile, sourcePath, componentPath)
    .some((binding) => bindingUsedByControl(control.node, binding, control.checker));
}

function controlKey(source, control) {
  return `${source}\0${control}`;
}

export function evaluateComponentReuse({ prBody, baseSha, headSha }) {
  const addedComponents = changedPaths(baseSha, headSha, "AR").filter((path) =>
    COMPONENT_FILE.test(path) && isProductionUiFile(path),
  );
  const inlineMenus = changedPaths(baseSha, headSha, "AMR").filter((path) =>
    isProductionUiFile(path) && INLINE_MENU.test(addedText(baseSha, headSha, path)),
  );
  const triggeringFiles = [...new Set([...addedComponents, ...inlineMenus])];

  if (triggeringFiles.length === 0) {
    return { pass: true, message: "No new component file or inline menu needs a reuse declaration." };
  }

  const controls = new Map();
  const unidentified = [];
  for (const source of triggeringFiles) {
    const found = controlsInFile(baseSha, headSha, source);
    if (found.size === 0) unidentified.push(source);
    for (const [control, node] of found) controls.set(controlKey(source, control), node);
  }
  if (unidentified.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} No changed exported JSX control could be identified in: ${unidentified.join(", ")}.`,
    };
  }

  const section = reuseSection(prBody);
  if (!section) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} Add a non-empty "## Components reused" section for ${[...controls.keys()].map((key) => key.replace("\0", ":")).join(", ")}.`,
    };
  }

  const mappings = declaredMappings(section);
  if (mappings.length === 0 || mappings.some(({ control }) => !control)) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} Use \`ExportedControl\` in \`src/path/to/control.tsx\` -> \`src/components/reused.tsx\` for each control.`,
    };
  }

  const mappingKeys = mappings.map(({ source, control }) => controlKey(source, control));
  const duplicates = mappingKeys.filter((key, index) => mappingKeys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} Each exported control must appear exactly once; duplicate mappings: ${[...new Set(duplicates)].map((key) => key.replace("\0", ":")).join(", ")}.`,
    };
  }

  const declaredKeys = new Set(mappingKeys);
  const missingControls = [...controls.keys()].filter((key) => !declaredKeys.has(key));
  if (missingControls.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} These changed exported controls have no mapping: ${missingControls.map((key) => key.replace("\0", ":")).join(", ")}.`,
    };
  }

  const extraControls = [...declaredKeys].filter((key) => !controls.has(key));
  if (extraControls.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} These mappings do not identify a changed exported control: ${extraControls.map((key) => key.replace("\0", ":")).join(", ")}.`,
    };
  }

  const weakReasons = mappings.filter(({ reused, reason }) => !reused && (reason?.length ?? 0) < 20);
  if (weakReasons.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} "No existing component fits" needs a specific justification of at least 20 characters.`,
    };
  }

  const reusedMappings = mappings.filter(({ reused }) => reused);
  const reusedPaths = [...new Set(reusedMappings.map(({ reused }) => reused))];
  const missing = reusedPaths.filter((path) => !pathExistsOnBase(baseSha, path));
  if (missing.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} These named components do not exist on the base branch: ${missing.join(", ")}.`,
    };
  }

  const unused = reusedMappings.filter(({ source, control, reused }) =>
    !controlUsesComponent(source, reused, controls.get(controlKey(source, control))),
  );
  if (unused.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} Each imported component must be used by its named control: ${unused.map(({ source, control, reused }) => `${source}:${control} -> ${reused}`).join(", ")}.`,
    };
  }

  const justified = mappings.length - reusedMappings.length;
  return {
    pass: true,
    message: `Components reused: ${reusedPaths.join(", ") || "none"}; justified new controls: ${justified}.`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [bodyFile, baseSha, headSha] = process.argv.slice(2);
  if (!bodyFile || !baseSha || !headSha) {
    console.error("usage: component-reuse-gate.mjs <pr-body-file> <base-sha> <head-sha>");
    process.exit(2);
  }
  try {
    const result = evaluateComponentReuse({
      prBody: readFileSync(bodyFile, "utf8"),
      baseSha,
      headSha,
    });
    console.log(result.message);
    process.exit(result.pass ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
