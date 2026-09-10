import { execFileSync } from "node:child_process";

const EXEMPT_TAGS = new Set(["BUGFIX", "INFRA"]);
const CROSS_CHECK_LINE_BUDGET = 150;
const FLAG_KEY_MODULES = new Set(["@/lib/flags", "@/lib/flags/keys"]);
const UI_INCLUDE = [
  /^src\/components\//,
  /^src\/pages\/(?!api\/)/,
  /^src\/app\//,
  /\.(tsx|css)$/,
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
    if (char === "'" && (isJsxTextApostrophe(source, index) ||
        (/[A-Za-z0-9]/.test(source[index - 1] ?? "") && /[A-Za-z0-9]/.test(source[index + 1] ?? "")))) {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        const next = source[index];
        if (quote !== "`" && next === "\n") break;
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
      tokens.push({ type: quote === "`" ? "template" : "string", value });
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

function parseFlagRegistry(ref) {
  const tokens = tokenize(git(["show", `${ref}:src/lib/flags/keys.ts`]));
  const byIdentifier = new Map();
  const byValue = new Map();
  for (let index = 0; index + 4 < tokens.length; index += 1) {
    const slice = tokens.slice(index, index + 5);
    if (
      slice[0].value !== "export" || slice[1].value !== "const" ||
      slice[2].type !== "identifier" || slice[3].value !== "=" ||
      slice[4].type !== "string"
    ) continue;
    const identifier = slice[2].value;
    const value = slice[4].value;
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
  const tokens = tokenize(git(["show", `${ref}:${modulePath}`]));
  for (let index = 0; index + 4 < tokens.length; index += 1) {
    if (
      tokens[index].value === "export" && tokens[index + 1].value === "const" &&
      tokens[index + 2].value === specifier.imported && tokens[index + 3].value === "=" &&
      tokens[index + 4].type === "string"
    ) return tokens[index + 4].value;
  }
  throw new Error(`feature flag key ${localName} is not an exported string constant`);
}

function parseDefinitions(ref, registry) {
  const source = git(["show", `${ref}:src/lib/flags.ts`]);
  const tokens = tokenize(source);
  const imports = parseImports(source);
  const declaration = tokens.findIndex((token, index) =>
    token.value === "FEATURE_FLAG_DEFINITIONS" &&
    tokens[index + 1]?.value === "=" && tokens[index + 2]?.value === "[",
  );
  if (declaration === -1) throw new Error("FEATURE_FLAG_DEFINITIONS array was not found");

  const keys = [];
  let arrayDepth = 1;
  let objectDepth = 0;
  let objectKey = null;
  for (let index = declaration + 3; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === "[") arrayDepth += 1;
    if (token.value === "]") {
      arrayDepth -= 1;
      if (arrayDepth === 0) break;
    }
    if (arrayDepth !== 1) continue;
    if (token.value === "{") {
      objectDepth += 1;
      if (objectDepth === 1) objectKey = null;
      continue;
    }
    if (token.value === "}") {
      if (objectDepth === 1) {
        if (!objectKey) throw new Error("feature flag definition has no key");
        keys.push(objectKey);
      }
      objectDepth -= 1;
      continue;
    }
    if (
      objectDepth === 1 && token.value === "key" &&
      tokens[index + 1]?.value === ":"
    ) {
      if (objectKey) throw new Error("feature flag definition has duplicate key fields");
      const valueToken = tokens[index + 2];
      if (valueToken?.type === "string") objectKey = valueToken.value;
      else if (valueToken?.type === "identifier") {
        objectKey = registry.byIdentifier.get(valueToken.value) ??
          resolveImportedStringConstant(ref, imports, valueToken.value);
      } else throw new Error("feature flag definition key must be a string or key constant");
    }
  }
  if (arrayDepth !== 0 || objectDepth !== 0) throw new Error("malformed FEATURE_FLAG_DEFINITIONS array");
  if (new Set(keys).size !== keys.length) throw new Error("duplicate FEATURE_FLAG_DEFINITIONS key");

  const defaultMode = tokens.findIndex((token, index) =>
    token.value === "DEFAULT_FEATURE_FLAG_MODE" &&
    tokens.slice(index + 1, index + 8).some((next) => next.value === "="),
  );
  if (defaultMode === -1) throw new Error("DEFAULT_FEATURE_FLAG_MODE was not found");
  const equals = tokens.findIndex((token, index) => index > defaultMode && index < defaultMode + 8 && token.value === "=");
  const mode = tokens[equals + 1];
  if (mode?.type !== "string") throw new Error("DEFAULT_FEATURE_FLAG_MODE must be a string literal");
  return { keys, defaultMode: mode.value };
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

function referencesFlagAtRuntime(ref, path, registry) {
  const source = git(["show", `${ref}:${path}`]);
  const imports = parseImports(source);
  const helpers = new Set();
  const flagLocals = new Map();
  for (const declaration of imports) {
    for (const specifier of declaration.specifiers) {
      if (declaration.module === "@/hooks/useFlag" && specifier.imported === "useFlag") {
        helpers.add(specifier.local);
      }
      if (declaration.module === "@/lib/flags" && specifier.imported === "isFeatureEnabled") {
        helpers.add(specifier.local);
      }
      if (FLAG_KEY_MODULES.has(declaration.module) && registry.byIdentifier.has(specifier.imported)) {
        flagLocals.set(specifier.local, registry.byIdentifier.get(specifier.imported));
      }
    }
  }

  const tokens = tokenize(source);
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    if (!helpers.has(tokens[index].value) || tokens[index + 1].value !== "(") continue;
    const argument = tokens[index + 2];
    if (argument.type === "string" && registry.byValue.has(argument.value)) return argument.value;
    if (argument.type === "identifier" && flagLocals.has(argument.value)) return flagLocals.get(argument.value);
  }
  return null;
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
  if (uiFiles.length === 0) {
    return { pass: true, reason: "No changed file matches the UI-change path filter." };
  }

  const titleMatch = title.match(/^HTPR-(\d+) \[([^\]]+)\] \S/);
  const autoRevert = isVerifiedAutoRevert(title, baseSha, headSha);
  const tag = titleMatch?.[2] ?? null;
  const exempt = autoRevert || (tag && EXEMPT_TAGS.has(tag));
  if (exempt) {
    const uiAdded = git(["diff", "--numstat", `${baseSha}...${headSha}`])
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
    const baseRegistry = parseFlagRegistry(mergeBase);
    const headRegistry = parseFlagRegistry(headSha);
    const baseDefinitions = parseDefinitions(mergeBase, baseRegistry);
    const headDefinitions = parseDefinitions(headSha, headRegistry);
    const removed = baseDefinitions.keys.filter((key) => !headDefinitions.keys.includes(key));
    if (removed.length > 0) return failure(`The pull request removes existing feature flag definition ${removed[0]}.`);

    const added = headDefinitions.keys.filter((key) => !baseDefinitions.keys.includes(key));
    if (added.length > 0) {
      const ticketPrefix = `htpr-${titleMatch[1]}-`;
      if (added.some((key) => !key.startsWith(ticketPrefix))) {
        return failure(`New feature flag keys must start with ${ticketPrefix} to match this pull request.`);
      }
      if (headDefinitions.defaultMode !== "OWNER_AND_QA") {
        return failure("New feature flags must default to Owner + QA.");
      }
      return { pass: true, reason: `[${tag}] adds ticket-specific feature flag ${added.join(", ")} with the Owner + QA default.` };
    }

    for (const path of uiFiles) {
      try {
        git(["cat-file", "-e", `${headSha}:${path}`]);
      } catch {
        continue;
      }
      const key = referencesFlagAtRuntime(headSha, path, headRegistry);
      if (key) return { pass: true, reason: `[${tag}] calls a feature gate with registered key ${key} in ${path}.` };
    }
  } catch (error) {
    return failure(`Feature flag files or imports could not be parsed safely: ${error.message}`);
  }

  const shownFiles = `${uiFiles.slice(0, 5).join(", ")}${uiFiles.length > 5 ? ", ..." : ""}`;
  return failure(
    `[${tag}] touches UI files (${shownFiles}) without a feature flag. Add a ticket-specific entry to ` +
    "FEATURE_FLAG_DEFINITIONS, or call useFlag/isFeatureEnabled with a registered key in a changed UI file.",
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
