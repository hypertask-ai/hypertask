const { readFileSync, readdirSync } = require("node:fs");
const { join, relative } = require("node:path");

const SOURCE_PATH_PATTERN = /(?:src\/|lib\/|components\/|pages\/|app\/|\.github\/workflows|eslint-local-rules\/|scripts\/[^/]+\.(?:m?js|tsx?)|tsconfig)/;

function discoverTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...discoverTestFiles(fullPath));
    } else if (entry.isFile() && /\.test\.(?:cjs|ts)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function firstArgumentRange(code, start) {
  let depth = 0;
  for (let end = start; end < code.length; end++) {
    const char = code[end];
    if ((char === "," || char === ")") && depth === 0) return [start, end];
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) depth--;
  }
  return [start, code.length];
}

function initializerEnd(code, start) {
  let depth = 0;
  for (let end = start; end < code.length; end++) {
    const char = code[end];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (depth === 0 && (char === ";" || char === "\n")) return end;
  }
  return code.length;
}

function declarationsOf(code) {
  const found = new Map();
  for (const match of code.matchAll(
    /\b(?:const|let|var)\s+([$A-Z_a-z][\w$]*)\s*=(?!=)|\b([$A-Z_a-z][\w$]*)\s*=(?!=)/g,
  )) {
    const name = match[1] ?? match[2];
    const start = match.index + match[0].length;
    found.set(name, { start, end: initializerEnd(code, start), at: match.index });
  }
  return found;
}

function detectSourceTextRegex(source) {
  const literals = [];
  const code = source.replace(
    /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g,
    (text, start) => {
      if (!text.startsWith("/")) {
        literals.push({ start, end: start + text.length, value: text.slice(1, -1), quote: text[0] });
      }
      return text.replace(/[^\r\n]/g, " ");
    },
  );
  const declarations = declarationsOf(code);

  function isSourceRange(start, end, readAt, depth) {
    if (literals.some((literal) =>
      literal.start >= start && literal.end <= end && SOURCE_PATH_PATTERN.test(literal.value))) {
      return true;
    }
    if (/\.github\/workflows|eslint-local-rules|tsconfig/.test(code.slice(start, end))) return true;
    if (depth >= 2) return false;
    const identifiers = new Set(
      [...code.slice(start, end).matchAll(/(?<![\w$.])[$A-Z_a-z][\w$]*/g)].map(([name]) => name),
    );
    for (const name of identifiers) {
      const declaration = declarations.get(name);
      if (declaration && declaration.at < readAt && isSourceRange(declaration.start, declaration.end, readAt, depth + 1)) {
        return true;
      }
    }
    return false;
  }

  const sourceVariables = new Set();
  const inlineSourceReads = [];
  for (const read of code.matchAll(/\breadFileSync\s*\(/g)) {
    const readAt = read.index;
    const [argStart, argEnd] = firstArgumentRange(code, readAt + read[0].length);
    if (!isSourceRange(argStart, argEnd, readAt, 0)) continue;
    const before = code.slice(Math.max(0, readAt - 240), readAt);
    const statement = before.slice(Math.max(
      before.lastIndexOf(";"),
      before.lastIndexOf("{"),
      before.lastIndexOf("}"),
    ) + 1);
    const target = statement.match(/\b([$A-Z_a-z][\w$]*)\s*=(?!=)/);
    if (target) sourceVariables.add(target[1]);
    else inlineSourceReads.push(readAt);
  }

  for (const readAt of [...inlineSourceReads]) {
    const statementStart = Math.max(0, readAt - 240);
    const statement = code.slice(statementStart, readAt);
    const opensAssertion = /\bassert\w*\s*\([^;]*$/.test(statement);
    if (!opensAssertion) inlineSourceReads.splice(inlineSourceReads.indexOf(readAt), 1);
  }

  const matchedVariables = new Set();
  if (inlineSourceReads.length > 0) matchedVariables.add("readFileSync");
  for (const assertion of code.matchAll(/\bassert\.(?:match|doesNotMatch)\s*\(/g)) {
    const [start, end] = firstArgumentRange(code, assertion.index + assertion[0].length);
    const argument = code.slice(start, end);
    for (const name of sourceVariables) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?<![\\w$.])${escapedName}(?![\\w$])`).test(argument)) {
        matchedVariables.add(name);
      }
    }
    if (inlineSourceReads.some((readAt) => readAt >= start && readAt < end)) {
      matchedVariables.add("readFileSync");
    }
  }
  return { offender: matchedVariables.size > 0, matchedVariables: [...matchedVariables] };
}

function findOffenders(root) {
  return discoverTestFiles(join(root, "tests"))
    .filter((file) => detectSourceTextRegex(readFileSync(file, "utf8")).offender)
    .map((file) => relative(root, file))
    .sort();
}

function sampleEvenly(list, n) {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError("Sample size must be a positive integer");
  if (list.length <= n) return list;
  if (n === 1) return [list[0]];
  return Array.from({ length: n }, (_, index) => list[Math.round(index * (list.length - 1) / (n - 1))]);
}

function allowlistDiff(allowlist, offenders) {
  const allowed = new Set(allowlist);
  const detected = new Set(offenders);
  return {
    added: [...allowed].filter((path) => !detected.has(path)).sort(),
    removed: [...detected].filter((path) => !allowed.has(path)).sort(),
  };
}

module.exports = {
  SOURCE_PATH_PATTERN,
  discoverTestFiles,
  detectSourceTextRegex,
  findOffenders,
  sampleEvenly,
  allowlistDiff,
};
