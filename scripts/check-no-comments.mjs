#!/usr/bin/env node
import { existsSync, globSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedComment, isGeneratedFile } from "../eslint-local-rules/no-comments.mjs";
import { parseSource } from "./strip-comments.mjs";

export const baselinePath = ".github/no-comments-baseline.json";
const scriptGlob = ".github/scripts/**/*";
const workflowGlob = ".github/workflows/*.{yml,yaml}";
const scriptExtensions = new Set([".js", ".cjs", ".mjs"]);
const hashExtensions = new Set([".sh", ".py", ".yml", ".yaml"]);
const message = (file, line) => `Comment in ${file}:${line}. Remove it and name the intent in code.`;

export const allowedHashComments = [
  /^#\s*(?:yaml-language-server|actionlint|yamllint|shellcheck)\b/,
  /^#\s*(?:renovate|zizmor|gitleaks)\s*:/,
  /^#\s*(?:prettier-ignore|nosemgrep)\b/,
  /^#\s*(?:noqa|type:|pylint:|fmt:|isort:|mypy:|pragma:|pyright:)\b/,
  /^#!/,
];

function hashComments(source) {
  const found = [];
  source.split(/\r?\n/).forEach((text, index) => {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("#")) return;
    if (allowedHashComments.some((pattern) => pattern.test(trimmed))) return;
    found.push({ line: index + 1, text: trimmed });
  });
  return found;
}

function scriptComments(source, file) {
  const parsed = parseSource(source, file);
  if (isGeneratedFile(file, parsed.comments)) return [];
  return parsed.comments
    .filter((comment) => !isAllowedComment(comment, file, source))
    .map((comment) => ({ line: comment.loc.start.line, text: source.slice(...comment.range) }));
}

export function isHashFile(source, file) {
  const extension = extname(file);
  return hashExtensions.has(extension) || (extension === "" && source.startsWith("#!"));
}

export function disallowedComments(source, file) {
  if (scriptExtensions.has(extname(file))) return scriptComments(source, file);
  if (isHashFile(source, file)) return hashComments(source);
  throw new Error(`check-no-comments: ${file} is not a script or a workflow file`);
}

function expand(paths) {
  const files = new Set();
  for (const path of paths) {
    const absolute = resolve(path);
    if (!existsSync(absolute)) throw new Error(`check-no-comments: ${path} does not exist`);
    if (!statSync(absolute).isDirectory()) {
      files.add(path);
      continue;
    }
    for (const file of globSync(`${path.replace(/[\\/]+$/, "")}/**/*`)) {
      if (!statSync(resolve(file)).isFile()) continue;
      if (scriptExtensions.has(extname(file)) || isHashFile(readFileSync(file, "utf8"), file)) files.add(file);
    }
  }
  return [...files].sort();
}

export function defaultFiles() {
  const scripts = globSync(scriptGlob)
    .filter((file) => statSync(resolve(file)).isFile())
    .filter((file) => scriptExtensions.has(extname(file)) || isHashFile(readFileSync(file, "utf8"), file));
  return [...scripts, ...globSync(workflowGlob)].sort();
}

export function loadBaseline(path = baselinePath) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

export function check(files, baseline, root = process.cwd()) {
  const violations = [];
  const counts = {};
  for (const file of files) {
    const absolute = resolve(root, file);
    const key = relative(root, absolute).split(sep).join("/");
    const found = disallowedComments(readFileSync(absolute, "utf8"), file);
    counts[key] = found.length;
    for (const comment of found.slice(baseline[key] ?? 0)) violations.push(message(key, comment.line));
  }
  const stale = Object.entries(baseline)
    .filter(([key, allowed]) => (counts[key] ?? 0) < allowed)
    .map(([key, allowed]) => `${key}: baseline allows ${allowed}, found ${counts[key] ?? 0}`);
  return { violations, stale, allowed: Object.values(baseline).reduce((total, count) => total + count, 0) };
}

function writeBaseline(files, root) {
  const counts = {};
  for (const file of files) {
    const absolute = resolve(root, file);
    const key = relative(root, absolute).split(sep).join("/");
    const found = disallowedComments(readFileSync(absolute, "utf8"), file);
    if (found.length) counts[key] = found.length;
  }
  return `${JSON.stringify(counts, null, 2)}\n`;
}

function main(args) {
  const options = { baseline: baselinePath, write: false, files: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--baseline") {
      index += 1;
      options.baseline = args[index];
      if (!options.baseline) throw new Error("check-no-comments: --baseline needs a path");
    } else if (arg === "--write-baseline") {
      options.write = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`check-no-comments: unknown option ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  const root = process.cwd();
  const files = options.files.length ? expand(options.files) : defaultFiles();
  const target = options.baseline === baselinePath ? join(root, baselinePath) : options.baseline;
  if (options.write) {
    writeFileSync(target, writeBaseline(files, root));
    console.log(`Wrote ${options.baseline} from ${files.length} files.`);
    return 0;
  }
  const { violations, stale, allowed } = check(files, loadBaseline(options.baseline), root);
  for (const line of stale) console.log(`Stale allowance: ${line}. Lower it in ${options.baseline}.`);
  for (const line of violations) console.log(line);
  console.log(`${violations.length} new comments in ${files.length} files; ${allowed} grandfathered in ${options.baseline}.`);
  return violations.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
