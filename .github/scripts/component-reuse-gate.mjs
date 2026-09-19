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
const INLINE_MENU = /(?:aria-haspopup\s*=\s*(?:["']menu["']|\{\s*["']menu["']\s*\})|role\s*=\s*(?:["']menu(?:item)?["']|\{\s*["']menu(?:item)?["']\s*\})|<(?:DropdownMenu|Menu)(?:[A-Z][A-Za-z]*|\s|>))/m;

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
  const pattern = /^\s*-\s+`([^`\r\n]+)`\s+in\s+`(src\/[^`\r\n]+\.[cm]?[jt]sx?)`\s*->\s*`(src\/components\/[^`\r\n]+\.[cm]?[jt]sx?)`\s*$/gm;
  return [...section.matchAll(pattern)].map((match) => ({
    control: match[1].trim(),
    source: match[2],
    reused: match[3],
  }));
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

function importedSpecifiers(source, sourcePath) {
  const scriptKind = sourcePath.endsWith(".tsx") ? typescript.ScriptKind.TSX
    : sourcePath.endsWith(".jsx") ? typescript.ScriptKind.JSX
      : sourcePath.endsWith(".js") ? typescript.ScriptKind.JS
        : typescript.ScriptKind.TS;
  const sourceFile = typescript.createSourceFile(
    sourcePath,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const specifiers = [];
  const visit = (node) => {
    if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) &&
        node.moduleSpecifier && typescript.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (typescript.isCallExpression(node) && node.arguments.length === 1 &&
               typescript.isStringLiteralLike(node.arguments[0]) &&
               (node.expression.kind === typescript.SyntaxKind.ImportKeyword ||
                (typescript.isIdentifier(node.expression) && node.expression.text === "require"))) {
      specifiers.push(node.arguments[0].text);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function importsComponent(headSha, sourcePath, componentPath) {
  const specifiers = importedSpecifiers(sourceAt(headSha, sourcePath), sourcePath)
    .map((specifier) => resolveImport(sourcePath, specifier))
    .filter(Boolean);
  const component = withoutExtension(componentPath);
  return specifiers.some((specifier) => {
    const imported = withoutExtension(specifier);
    return imported === component || `${imported}/index` === component;
  });
}

export function evaluateComponentReuse({ prBody, baseSha, headSha }) {
  const addedComponents = changedPaths(baseSha, headSha, "A").filter((path) =>
    COMPONENT_FILE.test(path) && isProductionUiFile(path),
  );
  const inlineMenus = changedPaths(baseSha, headSha, "AM").filter((path) =>
    isProductionUiFile(path) && INLINE_MENU.test(addedText(baseSha, headSha, path)),
  );
  const triggeringFiles = [...new Set([...addedComponents, ...inlineMenus])];

  if (triggeringFiles.length === 0) {
    return { pass: true, message: "No new component file or inline menu needs a reuse declaration." };
  }

  const section = reuseSection(prBody);
  if (!section) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} Add a non-empty "## Components reused" section for ${triggeringFiles.join(", ")}.`,
    };
  }

  const mappings = declaredMappings(section);
  if (mappings.length === 0 || mappings.some(({ control }) => !control)) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} Use \`Control\` in \`src/path/to/control.tsx\` -> \`src/components/reused.tsx\` for each control.`,
    };
  }

  const declaredSources = new Set(mappings.map(({ source }) => source));
  const missingSources = triggeringFiles.filter((path) => !declaredSources.has(path));
  if (missingSources.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} These changed files have no control mapping: ${missingSources.join(", ")}.`,
    };
  }

  const extraSources = [...declaredSources].filter((path) => !triggeringFiles.includes(path));
  if (extraSources.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} These mappings do not identify a triggering file: ${extraSources.join(", ")}.`,
    };
  }

  const reusedPaths = [...new Set(mappings.map(({ reused }) => reused))];
  const missing = reusedPaths.filter((path) => !pathExistsOnBase(baseSha, path));
  if (missing.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} These named components do not exist on the base branch: ${missing.join(", ")}.`,
    };
  }

  const unused = mappings.filter(({ source, reused }) => !importsComponent(headSha, source, reused));
  if (unused.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} Each named component must be imported by its control file: ${unused.map(({ source, reused }) => `${source} -> ${reused}`).join(", ")}.`,
    };
  }

  return {
    pass: true,
    message: `Components reused: ${reusedPaths.join(", ")}.`,
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
