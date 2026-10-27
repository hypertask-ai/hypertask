import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";
import parser from "@typescript-eslint/parser";
import scss from "postcss-scss";
import valueParser from "postcss-value-parser";

const number = /(?:^|[\s,(])[-+]?(?:\d*\.)?\d+/g;
const palette = /(?:^|:)!?(?:text|bg|border(?:-[trblxyse])?|divide|outline|ring(?:-offset)?|fill|stroke|from|via|to|decoration|placeholder|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?:\/[^\s]+)?!?$/;
const typography = /(?:^|:)!?(?:text|leading)-\[(?:length:)?-?[\d.]+(?:px|rem|em|%)?\]/;
const advice = "Use text-micro/text-content and text-text-light-gray/bg-modalBackground from tailwind.config.ts; CSS uses var(--...) tokens defined in src/styles/globals.scss.";

function styleOffsets(value, sizing = false) {
  const offsets = [];
  valueParser(value).walk((node) => {
    if (["string", "comment"].includes(node.type) || (node.type === "function" && node.value.toLowerCase() === "url")) return false;
    if (node.type === "word" && (/^#[\da-f]{3,8}(?:!important)?$/i.test(node.value) || (sizing && /^[-+]?(?:\d*\.)?\d/.test(node.value)))) offsets.push(node.sourceIndex);
    if (node.type === "function" && /^(?:rgb|rgba|hsl|hsla)$/i.test(node.value)) {
      const first = node.nodes.find((child) => child.type !== "space" && child.type !== "comment");
      if (first?.type === "word" && /^[-+]?(?:\d*\.)?\d/.test(first.value)) {
        offsets.push(node.sourceIndex, ...node.nodes.filter((child) => child.type === "word" && /^[-+]?(?:\d*\.)?\d/.test(child.value)).map((child) => child.sourceIndex));
      }
    }
  });
  return [...new Set(offsets)];
}

function utilityOffsets(value) {
  const offsets = [];
  for (const match of value.matchAll(/\S+/g)) {
    const token = match[0];
    if (palette.test(token) || typography.test(token)) offsets.push(match.index);
    const start = token.indexOf("[");
    const end = token.lastIndexOf("]");
    if (start >= 0 && end > start) offsets.push(...styleOffsets(token.slice(start + 1, end)).map((offset) => match.index + start + 1 + offset));
  }
  return [...new Set(offsets)];
}

export function lintStyles(source, filename) {
  if (/\.(css|scss)$/.test(filename)) {
    const findings = [];
    const tree = scss.parse(source, { from: filename });
    tree.walkDecls((decl) => {
      const tokenOwner = /^(?:src\/styles\/globals\.scss|src\/app\/globals\.css|src\/styles\/tailwindThemes\/[^/]+)$/.test(filename);
      if (tokenOwner && decl.prop.startsWith("--")) return;
      const raw = source.slice(decl.source.start.offset, decl.source.end.offset);
      const valueOffset = raw.indexOf(":") + 1;
      const value = raw.slice(valueOffset).replace(/;$/, "");
      for (const match of styleOffsets(value, /^(?:font-size|line-height)$/.test(decl.prop))) {
        const offset = decl.source.start.offset + valueOffset + match;
        findings.push({ line: source.slice(0, offset).split("\n").length, message: advice });
      }
    });
    tree.walkAtRules("apply", (rule) => {
      const raw = source.slice(rule.source.start.offset, rule.source.end.offset);
      const start = raw.indexOf("apply") + 5;
      const params = raw.slice(start).replace(/;$/, "").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
      for (const offset of utilityOffsets(params)) {
        findings.push({ line: source.slice(0, rule.source.start.offset + start + offset).split("\n").length, message: advice });
      }
    });
    return findings;
  }
  const rule = {
    meta: { schema: [] },
    create(context) {
      const { sourceCode } = context;
      function constantValue(node, seen = new WeakSet()) {
        if (!node || seen.has(node)) return undefined;
        seen.add(node);
        if (["TSAsExpression", "TSTypeAssertion", "TSSatisfiesExpression", "TSNonNullExpression", "ChainExpression"].includes(node.type)) return constantValue(node.expression, seen);
        if (node.type === "Identifier") {
          for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
            const variable = scope.set.get(node.name);
            if (!variable) continue;
            const definition = variable.defs.find((entry) => entry.parent?.kind === "const");
            return constantValue(definition?.node.init, seen);
          }
          return undefined;
        }
        if (node.type === "MemberExpression") {
          const object = constantValue(node.object, seen);
          const key = node.computed ? node.property.value : node.property.name;
          if (object?.type !== "ObjectExpression" || object.properties.some((entry) => entry.type === "SpreadElement")) return undefined;
          const property = object.properties.findLast((entry) => !entry.computed && (entry.key.name ?? entry.key.value) === key);
          return constantValue(property?.value, seen);
        }
        return node;
      }
      function report(loc, usage) {
        context.report({ loc, message: advice });
        if (usage && usage.loc.start.line !== (loc.start?.line ?? loc.line)) context.report({ loc: usage.loc, message: advice });
      }
      function inspect(node, style = false, visited = new WeakSet(), usage) {
        if (!node || typeof node !== "object" || visited.has(node)) return;
        visited.add(node);
        if (["Identifier", "MemberExpression"].includes(node.type)) {
          inspect(constantValue(node), style, visited, usage ?? node);
          return;
        }
        if ((node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateElement") {
          const value = node.type === "Literal" ? node.value : node.value.raw;
          for (const offset of style ? styleOffsets(value) : utilityOffsets(value)) {
            report(sourceCode.getLocFromIndex(node.range[0] + 1 + offset), usage);
          }
          return;
        }
        if (style && node.type === "Property" && ["fontSize", "lineHeight"].includes(node.key.name ?? node.key.value)) {
          if (node.value.type === "Literal" && (typeof node.value.value === "number" || new RegExp(number).test(node.value.value))) {
            report(node.value.loc, usage);
          }
        }
        if (!style && node.type === "Property" && (node.computed || node.key.type === "Literal")) inspect(node.key, false, visited, usage);
        for (const [key, child] of Object.entries(node)) {
          if (["parent", "loc", "range", "tokens", "comments", "key"].includes(key)) continue;
          if (Array.isArray(child)) child.forEach((item) => inspect(item, style, visited, usage));
          else if (child && typeof child === "object") inspect(child, style, visited, usage);
        }
      }
      return {
        JSXAttribute(node) {
          if (["className", "style"].includes(node.name.name)) inspect(node.value, node.name.name === "style");
        },
      };
    },
  };
  return new Linter().verify(source, [{
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { changed: { rules: { tokens: rule } } },
    rules: { "changed/tokens": "error" },
  }], { filename });
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "Cannot read style diff");
  return result.stdout;
}

export function checkChangedStyles(base, head) {
  const fork = git(["merge-base", base, head || "HEAD"]).trim();
  const revisions = head ? [fork, head] : [fork];
  const files = git(["diff", "--name-only", "--no-renames", "--diff-filter=ACM", "-z", ...revisions, "--", "src"])
    .split("\0").filter((file) => /\.(?:[jt]sx?|s?css)$/.test(file));
  let failures = 0;
  for (const file of files) {
    const diff = git(["diff", "--no-ext-diff", "--no-renames", "--unified=0", ...revisions, "--", file]);
    const added = new Set();
    for (const match of diff.matchAll(/^@@ .* \+(\d+)(?:,(\d+))? @@/gm)) {
      const first = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      for (let line = first; line < first + count; line++) added.add(line);
    }
    const source = head ? git(["show", `${head}:${file}`]) : readFileSync(file, "utf8");
    for (const finding of lintStyles(source, file)) {
      if (!finding.fatal && ![...added].some((line) => line >= finding.line && line <= (finding.endLine ?? finding.line))) continue;
      console.error(`${file}:${finding.line}: ${finding.message}`);
      failures++;
    }
  }
  if (failures) throw new Error(`${failures} added style violation(s)`);
  console.log("changed styles ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const base = process.argv[2] || git(["merge-base", "HEAD", "origin/production"]).trim();
    const head = process.argv[3] || "";
    checkChangedStyles(base, head);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
