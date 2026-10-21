#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { globSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@typescript-eslint/typescript-estree";
import { isAllowedComment, isGeneratedFile } from "../eslint-local-rules/no-comments.mjs";

const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export function parseSource(source, filename) {
  return parse(source, {
    comment: true, tokens: true, range: true, loc: true,
    jsx: /\.(?:tsx|jsx)$/.test(filename),
    filePath: filename,
  });
}

function jsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  lines.forEach((line, index) => {
    if (/[^ \t]/.test(line)) lastNonEmptyLine = index;
  });
  return lines.map((line, index) => {
    let text = line.replace(/\t/g, " ");
    if (index !== 0) text = text.replace(/^ +/, "");
    if (index !== lines.length - 1) text = text.replace(/ +$/, "");
    return text && index !== lastNonEmptyLine ? `${text} ` : text;
  }).join("");
}

export function normalizedAst(node) {
  if (!node || typeof node !== "object") return node;
  if (node.type === "JSXExpressionContainer" && node.expression.type === "JSXEmptyExpression") return undefined;
  if (node.type === "JSXText") {
    const value = jsxText(node.value);
    return value ? { type: "JSXText", value } : undefined;
  }
  if (Array.isArray(node)) {
    const children = [];
    for (const item of node) {
      const child = normalizedAst(item);
      if (child === undefined) continue;
      const previous = children.at(-1);
      if (previous?.type === "JSXText" && child?.type === "JSXText") previous.value += child.value;
      else children.push(child);
    }
    return children;
  }
  return Object.fromEntries(Object.entries(node)
    .filter(([key]) => !["range", "loc", "comments", "tokens"].includes(key))
    .map(([key, value]) => [key, normalizedAst(value)]));
}

export function assertEquivalent(before, after, filename) {
  assert.deepStrictEqual(normalizedAst(parseSource(after, filename)), normalizedAst(parseSource(before, filename)),
    `AST mismatch: ${filename}`);
}

function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((child) => visit(child, callback));
  callback(node);
  for (const [key, child] of Object.entries(node)) {
    if (!["range", "loc", "comments", "tokens"].includes(key)) visit(child, callback);
  }
}

function removal(source, start, end) {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const nextNewline = source.indexOf("\n", end);
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  const before = source.slice(lineStart, start);
  const after = source.slice(end, lineEnd);
  if (/^[\t \r]*$/.test(before) && /^[\t \r]*$/.test(after)) {
    return { start: lineStart, end: nextNewline === -1 ? lineEnd : lineEnd + 1, text: "" };
  }
  if (/^[\t \r]*$/.test(after)) {
    start -= before.match(/[\t ]*$/)[0].length;
  }
  const removed = source.slice(start, end);
  const text = /[\r\n]/.test(removed) ? "\n" :
    start > 0 && end < source.length && /\S/.test(source[start - 1]) && /\S/.test(source[end]) ? " " : "";
  return { start, end, text };
}

function applyEdits(source, edits) {
  let output = "";
  let cursor = 0;
  const boundaries = [];
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    assert.ok(edit.start >= cursor, "Overlapping comment removal ranges");
    output += source.slice(cursor, edit.start) + edit.text;
    boundaries.push(output.length);
    cursor = edit.end;
  }
  return { output: output + source.slice(cursor), boundaries };
}

function cleanBlankLines(source, boundaries, filename) {
  const tokens = parseSource(source, filename).tokens;
  if (!tokens.length && boundaries.length && !source.trim()) return "";
  const edits = [];
  for (const match of source.matchAll(/\r?\n(?:[\t ]*\r?\n)+/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!boundaries.some((position) => position >= start && position <= end)) continue;
    if (tokens.some((token) => token.type !== "JSXText" && token.range[0] < end && token.range[1] > start)) continue;
    const previous = tokens.findLast((token) => token.range[1] <= start);
    const next = tokens.find((token) => token.range[0] >= end);
    const afterOpeningBrace = previous?.type === "Punctuator" && previous.value === "{" &&
      !source.slice(previous.range[1], start).trim();
    const beforeClosingBrace = next?.type === "Punctuator" && next.value === "}" &&
      !source.slice(end, next.range[0]).trim();
    const newline = match[0].startsWith("\r\n") ? "\r\n" : "\n";
    if (afterOpeningBrace || beforeClosingBrace || end === source.length) edits.push({ start, end, text: newline });
    else if (match[0].split("\n").length - 1 >= 4) edits.push({ start, end, text: newline.repeat(2) });
  }
  return applyEdits(source, edits).output;
}

export function stripComments(source, filename) {
  const ast = parseSource(source, filename);
  const result = { source, removed: 0, tsIgnoreRemoved: 0, keptJsx: [], disallowed: [] };
  if (isGeneratedFile(filename, ast.comments)) return result;
  const disallowed = ast.comments.filter((comment) => !isAllowedComment(comment, filename, source));
  result.disallowed = disallowed.map((comment) => comment.loc.start.line);
  if (!disallowed.length) return result;
  const handled = new Set();
  const removedContainers = new Set();
  const edits = [];
  visit(ast, (node) => {
    if (node.type !== "JSXElement" && node.type !== "JSXFragment") return;
    node.children.forEach((child) => {
      if (child.type !== "JSXExpressionContainer" || child.expression.type !== "JSXEmptyExpression") return;
      const comments = ast.comments.filter((comment) => comment.range[0] >= child.range[0] && comment.range[1] <= child.range[1]);
      const rejected = comments.filter((comment) => disallowed.includes(comment));
      if (!rejected.length) return;
      if (rejected.length !== comments.length) return;
      rejected.forEach((comment) => handled.add(comment));
      const children = [];
      for (const sibling of node.children) {
        if (removedContainers.has(sibling)) continue;
        const previous = children.at(-1);
        if (previous?.type === "JSXText" && sibling.type === "JSXText") previous.value += sibling.value;
        else children.push(sibling.type === "JSXText" ? { ...sibling } : sibling);
      }
      const index = children.indexOf(child);
      const previous = children[index - 1];
      const next = children[index + 1];
      if (previous?.type === "JSXText" && next?.type === "JSXText" &&
          jsxText(previous.value) + jsxText(next.value) !== jsxText(previous.value + next.value)) {
        result.keptJsx.push(`${filename}:${child.loc.start.line}`);
        return;
      }
      removedContainers.add(child);
      edits.push({ ...removal(source, ...child.range), text: "" });
      result.removed += rejected.length;
      result.tsIgnoreRemoved += rejected.filter((comment) => /^\s*@ts-ignore\b/.test(comment.value)).length;
    });
  });
  const ordinary = disallowed.filter((comment) => !handled.has(comment));
  for (let index = 0; index < ordinary.length; index += 1) {
    const start = ordinary[index].range[0];
    let end = ordinary[index].range[1];
    result.removed += 1;
    if (/^\s*@ts-ignore\b/.test(ordinary[index].value)) result.tsIgnoreRemoved += 1;
    while (ordinary[index + 1] && /^[\t ]*$/.test(source.slice(end, ordinary[index + 1].range[0]))) {
      index += 1;
      end = ordinary[index].range[1];
      result.removed += 1;
      if (/^\s*@ts-ignore\b/.test(ordinary[index].value)) result.tsIgnoreRemoved += 1;
    }
    edits.push(removal(source, start, end));
  }
  const { output, boundaries } = applyEdits(source, edits);
  result.source = cleanBlankLines(output, boundaries, filename);
  assertEquivalent(source, result.source, filename);
  return result;
}

function collectFiles(paths) {
  const files = new Set();
  function collect(path) {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) collect(join(path, entry));
    } else if (extensions.has(extname(path))) files.add(path);
  }
  for (const path of paths) {
    const matches = /[*?{]/.test(path) ? globSync(path) : [path];
    assert.ok(matches.length, `No files match: ${path}`);
    matches.forEach(collect);
  }
  return [...files].sort();
}

function verifyAgainst(ref) {
  const files = execFileSync("git", ["diff", "--name-only", "-z", ref, "--", "src"], { encoding: "utf8" })
    .split("\0").filter((file) => extensions.has(extname(file)));
  let mismatches = 0;
  for (const filename of files) {
    try {
      const old = execFileSync("git", ["show", `${ref}:${filename}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      assertEquivalent(old, readFileSync(filename, "utf8"), filename);
    } catch (error) {
      mismatches += 1;
      console.error(`${filename}: ${error.message}`);
    }
  }
  console.log(`AST equivalence: ${files.length} changed files checked, ${mismatches} mismatches`);
  return mismatches ? 1 : 0;
}

function main(args) {
  if (args[0] === "--verify-against") {
    assert.equal(args.length, 2, "Usage: strip-comments.mjs --verify-against <git ref>");
    return verifyAgainst(args[1]);
  }
  assert.ok(args[0] === "--check" || args[0] === "--write", "Usage: strip-comments.mjs --check|--write [paths/globs] (default: src)");
  const write = args[0] === "--write";
  let dirty = 0;
  let changed = 0;
  let removed = 0;
  let tsIgnoreRemoved = 0;
  const keptJsx = [];
  for (const filename of collectFiles(args.length > 1 ? args.slice(1) : ["src"])) {
    const source = readFileSync(filename, "utf8");
    const result = stripComments(source, filename);
    if (result.disallowed.length) {
      dirty += 1;
      if (!write) console.log(`${filename}:${result.disallowed.join(",")}`);
    }
    if (result.source !== source) {
      changed += 1;
      if (write) writeFileSync(filename, result.source);
    }
    removed += result.removed;
    tsIgnoreRemoved += result.tsIgnoreRemoved;
    keptJsx.push(...result.keptJsx);
  }
  keptJsx.forEach((spot) => console.log(`Kept JSX comment (rendered text would change): ${spot}`));
  console.log(write ? `Rewrote ${changed} files; removed ${removed} comments; removed ${tsIgnoreRemoved} @ts-ignore directives; kept ${keptJsx.length} JSX comments` :
    `${dirty} files with disallowed comments; ${changed} files would be rewritten`);
  return write ? (keptJsx.length ? 1 : 0) : (dirty || changed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
