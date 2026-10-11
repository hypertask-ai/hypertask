// Picks the subset of tests worth running for a PR's changed files.
//
// PRs pay for the full suite on every push while Vercel's instant rollback is
// the real safety net for staging. So the PR lane runs only the tests that
// reference something the PR touched; the full suite still runs post-merge on
// staging (ci-build.yml push path), with auto-revert on red.
//
// Usage: node .github/scripts/select-tests.mjs [changed-file ...]
//        (reads newline-separated paths from stdin when no args are given)
// Prints "ALL" to run everything, otherwise one test path per line.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { discoverTestFiles } from "../../scripts/test-inventory.mjs";

const root = process.cwd();
const testsRoot = path.join(root, "tests");

// Touching any of these invalidates the whole selection premise (dependency
// graph, schema, tsconfig, the test runner itself), so run everything.
const WIDE_PATTERNS = [
  /^package(-lock)?\.json$/,
  /^prisma\//,
  /^tsconfig.*\.json$/,
  /^next\.config\./,
  /^eslint\.config\./,
  /^middleware\./,
  /^src\/middleware\./,
  /^scripts\/(run-tests|test-inventory)\.mjs$/,
  /^\.github\//,
];

// A shared-dir change with a broad blast radius is not worth guessing about.
const WIDE_FANOUT_DIRS = [/^src\/lib\//, /^src\/utils\//, /^src\/models\//];
const WIDE_FANOUT_THRESHOLD = 5;
const TOTAL_CHANGE_THRESHOLD = 40;

// Cheap suites that guard the runner and the demo path regardless of scope.
const ALWAYS = [
  "tests/test-inventory.test.cjs",
  "tests/demo-smoke.test.cjs",
  "tests/file-size-limit.test.cjs",
];

// Import-graph reachability. The path-substring match alone missed tests that
// import a changed file through a relative or "@/" specifier (YPER4-238: a
// lease script change skipped tests/ai-chat-cancellation.test.ts). A test is
// now selected when it can reach a changed file through imports, requires,
// path.join/resolve calls or any path-like string literal, transitively
// through src/, scripts/ and test helpers. Whatever cannot be resolved widens
// the selection, never narrows it.
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];
const LITERAL_RE = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
const JOIN_RE = /\b(?:path\.)?(?:join|resolve)\(/g;
const DYNAMIC_RE = /\b(?:require|import)\((?!\s*(?:["'`)]|(?:path\.)?(?:join|resolve)\())/;

const DYNAMIC_G = new RegExp(DYNAMIC_RE.source, "g");

// Loader shims (YPER4-267). Tests load a TypeScript file with a small helper:
// load("src/lib/x.ts", stubs) transpiles the file and hands it a require hook
// like `(request) => stubs[request] ?? require(request)`. That inner require
// forwards a specifier somebody else asked for, so on its own it says nothing
// about unknown dependencies: the file the loader reads is named by a literal
// at the call site (already an edge) and its own imports are traced from that
// file. Such a require is not "dynamic". The loader is dangerous only when it
// is called with a path the picker cannot read.
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "with", "else", "do", "try"]);
const FN_RE =
  /\bfunction\s*([A-Za-z_$][\w$]*)?\s*\(([^()]*)\)\s*\{|\(([^()]*)\)\s*=>|(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>|(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g;

// Index of the closer matching the opener at `open`, or -1.
function matchClose(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// End of an expression-bodied arrow that starts at `from`.
function expressionEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if ((c === ";" || c === ",") && depth === 0) return i;
  }
  return text.length;
}

function functionRanges(text) {
  const fns = [];
  FN_RE.lastIndex = 0;
  let m;
  while ((m = FN_RE.exec(text))) {
    let name = m[1] ?? "";
    const params = m[2] ?? m[3] ?? m[4] ?? m[6] ?? "";
    const after = FN_RE.lastIndex;
    if (m[5] !== undefined) {
      if (KEYWORDS.has(m[5])) continue;
      name = m[5];
    }
    let start;
    let end;
    if (m[3] !== undefined || m[4] !== undefined) {
      start = after + text.slice(after).match(/^\s*/)[0].length;
      end = text[start] === "{" ? matchClose(text, start) : expressionEnd(text, start);
    } else {
      start = after - 1;
      end = matchClose(text, start);
    }
    if (end === -1) continue;
    if (!name) {
      const before = text.slice(Math.max(0, m.index - 80), m.index);
      const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?$/.exec(before);
      if (decl) name = decl[1];
    }
    const ids = params
      .split(",")
      .map((p) => /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?:=|$)/.exec(p)?.[1])
      .filter(Boolean);
    fns.push({ name, params: new Set(ids), start, end });
  }
  return fns;
}

// Splits non-literal require/import calls into loader shims (the argument is a
// parameter of an enclosing function) and genuinely dynamic ones.
function classifyDynamic(text) {
  const loaders = new Set();
  let dynamic = false;
  const fns = functionRanges(text);
  DYNAMIC_G.lastIndex = 0;
  let m;
  while ((m = DYNAMIC_G.exec(text))) {
    const arg = /^\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(text.slice(DYNAMIC_G.lastIndex));
    const around = fns.filter((f) => f.start <= m.index && m.index <= f.end);
    if (!arg || !around.some((f) => f.params.has(arg[1]))) {
      dynamic = true;
      continue;
    }
    // Every named function around the forwarding require is a loader.
    for (const f of around) if (f.name) loaders.add(f.name);
  }
  loaders.delete("require");
  loaders.delete("import");
  return { dynamic, loaders };
}

// Same-length copy of `text` with comments and string contents blanked out so
// identifier scans ignore them. Code inside template `${...}` is kept.
function maskNonCode(text) {
  const out = text.split("");
  const blank = (a, b) => {
    for (let k = a; k < b && k < text.length; k++) if (text[k] !== "\n") out[k] = " ";
  };
  const stack = [];
  let cur = 0;
  let i = 0;
  let inTemplate = false;
  while (i < text.length) {
    const c = text[i];
    if (inTemplate) {
      if (c === "\\") { blank(i, i + 2); i += 2; continue; }
      if (c === "`") { inTemplate = false; blank(i, i + 1); i++; continue; }
      if (c === "$" && text[i + 1] === "{") {
        blank(i, i + 2);
        stack.push(cur);
        cur = 0;
        inTemplate = false;
        i += 2;
        continue;
      }
      blank(i, i + 1);
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const e = text.indexOf("\n", i);
      const end = e === -1 ? text.length : e;
      blank(i, end);
      i = end;
    } else if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      const end = e === -1 ? text.length : e + 2;
      blank(i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < text.length && text[k] !== c && text[k] !== "\n") k += text[k] === "\\" ? 2 : 1;
      blank(i, k + 1);
      i = k + 1;
    } else if (c === "`") {
      inTemplate = true;
      blank(i, i + 1);
      i++;
    } else {
      if (c === "{") cur++;
      else if (c === "}") {
        if (cur === 0 && stack.length > 0) {
          cur = stack.pop();
          inTemplate = true;
          blank(i, i + 1);
        } else cur--;
      }
      i++;
    }
  }
  return out.join("");
}

const LOADER_ARG_OK =new Set(["__dirname", "root"]);
const callCache = new Map();
const rangeCache = new Map();
const rangesOf = (file, text) => {
  if (!rangeCache.has(file)) rangeCache.set(file, functionRanges(text));
  return rangeCache.get(file);
};

// True when `text` calls `name(...)` with a first argument that is not a plain
// string literal or a path.join/resolve of literals and __dirname/root.
function callsWithUnknownPath(file, text, name, loaders) {
  const key = `${file}\0${name}\0${[...loaders].sort().join(",")}`;
  if (callCache.has(key)) return callCache.get(key);
  const masked = maskNonCode(text);
  const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  let bad = false;
  let m;
  while (!bad && (m = re.exec(masked))) {
    const at = m.index;
    const before = masked.slice(0, at).trimEnd();
    const next = masked.slice(at + name.length);
    // The loader's own definition.
    if (/\bfunction\s*\*?$/.test(before) || /\b(?:const|let|var)$/.test(before)) continue;
    if (/\bexports\s*\.$/.test(before) && /^\s*=(?!=)/.test(next)) continue;
    if (/\bimport$/.test(before) && /^\s+from\b/.test(next)) continue;
    const call = /^\s*\(/.exec(next);
    if (!call) {
      // Binding without a rename: `{ name } = require(...)`, `import { name }`,
      // `export { name }`, `module.exports = { name }`. Everything else is a
      // reference the picker cannot follow (.map(name), alias, bind, spread).
      let ok = false;
      if (/[{,]$/.test(before) && /^\s*[,}]/.test(next)) {
        let depth = 0;
        let j = at - 1;
        for (; j >= 0; j--) {
          if (masked[j] === "}") depth++;
          else if (masked[j] === "{") {
            if (depth === 0) break;
            depth--;
          }
        }
        const close = j >= 0 ? matchClose(masked, j) : -1;
        if (close !== -1) {
          const tail = masked.slice(close + 1);
          const head = masked.slice(0, j).trimEnd();
          ok =
            /^\s*=\s*(?:await\s+)?require\s*\(/.test(tail) ||
            /^\s*from\b/.test(tail) ||
            /\bexport$/.test(head) ||
            /\bexports\s*=$/.test(head);
        }
      }
      if (ok) continue;
      bad = true;
      break;
    }
    const open = at + name.length + call[0].length - 1;
    // Method definition `name(params) {`.
    const closeCall = matchClose(masked, open);
    if (closeCall !== -1 && /^\s*\{/.test(masked.slice(closeCall + 1)) && !/\.$/.test(before)) continue;
    // A call from inside a loader forwards that loader's own input; its callers
    // are checked instead.
    if (rangesOf(file, text).some((f) => f.name && loaders.has(f.name) && f.start <= at && at <= f.end)) continue;
    const rest = text.slice(open + 1);
    if (/^\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)\s*[,)]/.test(rest)) continue;
    const j = /^\s*(?:path\.)?(?:join|resolve)\(/.exec(rest);
    if (j) {
      const inner = open + 1 + j[0].length - 1;
      const close = matchClose(text, inner);
      if (close !== -1) {
        const args = text.slice(inner + 1, close).split(",").map((a) => a.trim());
        if (args.every((a) => LOADER_ARG_OK.has(a) || /^(?:"[^"]*"|'[^']*'|`[^`$]*`)$/.test(a))) continue;
      }
    }
    bad = true;
  }
  callCache.set(key, bad);
  return bad;
}

const analysisCache = new Map();
const existsCache = new Map();
const isFile = (rel) => {
  if (!existsCache.has(rel)) {
    let ok = false;
    try {
      ok = fs.statSync(path.join(root, rel)).isFile();
    } catch {}
    existsCache.set(rel, ok);
  }
  return existsCache.get(rel);
};
const clean = (p) => {
  const n = path.posix.normalize(p).replace(/^(\.\.\/)+/, "");
  return n === "." || n === ".." ? "" : n.replace(/\/$/, "");
};

// Top-level string-literal arguments of every path.join/resolve call. A call
// with a non-literal argument after its first literal is a prefix ("src/lib/").
function joinRefs(text, dir) {
  const out = [];
  JOIN_RE.lastIndex = 0;
  let m;
  while ((m = JOIN_RE.exec(text))) {
    let i = JOIN_RE.lastIndex;
    let depth = 1;
    let arg = "";
    const args = [];
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      if (depth === 0) break;
      if (c === "," && depth === 1) {
        args.push(arg.trim());
        arg = "";
      } else arg += c;
    }
    args.push(arg.trim());
    const base = args[0] === "__dirname" ? dir : "";
    const segs = [];
    let prefix = false;
    for (const a of args) {
      const lit = /^(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)$/.exec(a);
      if (lit) segs.push(lit[1] ?? lit[2] ?? lit[3]);
      else if (segs.length > 0) {
        prefix = true;
        break;
      }
    }
    if (segs.length === 0) continue;
    const ref = clean(path.posix.join(base, ...segs));
    if (ref) out.push({ ref, prefix });
  }
  return out;
}

function analyze(file) {
  if (analysisCache.has(file)) return analysisCache.get(file);
  const result = { edges: new Set(), refs: [], dynamic: false, loaders: new Set(), text: "" };
  analysisCache.set(file, result);
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, file), "utf8");
  } catch {
    return result;
  }
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) return result;
  result.text = text;
  const dir = path.posix.dirname(file);
  // path.join(root, "src") is mostly the "@/" alias shim. A bare top-level
  // directory only counts as a dependency on its whole tree when the file
  // also walks directories (contract tests that scan every source file).
  const walks = /\b(?:readdir(?:Sync)?|opendir|glob(?:Sync)?|walk\w*|collect\w*Files|ls-files)\b/.test(text);
  const add = (ref, prefix) => {
    if (!ref) return;
    if (!ref.includes("/") && !walks) return;
    result.refs.push({ ref, prefix });
    if (prefix) return;
    for (const ext of EXTENSIONS) {
      for (const cand of [ref + ext, `${ref}/index${ext}`]) {
        if (isFile(cand)) result.edges.add(cand);
      }
    }
  };
  for (const m of text.matchAll(LITERAL_RE)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    const cut = raw.indexOf("${");
    const lit = cut === -1 ? raw : raw.slice(0, cut);
    const prefix = cut !== -1;
    if (!lit.includes("/") && !lit.startsWith(".")) continue;
    if (lit.startsWith("./") || lit.startsWith("../")) {
      add(clean(path.posix.join(dir, lit)), prefix);
    } else if (lit.startsWith("@/")) add(`src/${lit.slice(2)}`, prefix);
    else if (!lit.startsWith("@") && !lit.startsWith("/")) add(clean(lit), prefix);
  }
  for (const { ref, prefix } of joinRefs(text, dir)) add(ref, prefix);
  // Any non-literal require/import makes the file unresolvable, whatever else
  // it resolves.
  if (DYNAMIC_RE.test(text)) {
    const { dynamic, loaders } = classifyDynamic(text);
    result.dynamic = dynamic;
    result.loaders = loaders;
  }
  return result;
}

const refMatches = ({ ref, prefix }, file) =>
  file === ref || file.startsWith(`${ref}/`) || (prefix && file.startsWith(ref));

// Which changed files can this test reach? An unresolvable dynamic
// require/import in the test or a test helper makes it reach everything (null).
function reaches(testFile, changed) {
  const hit = new Set();
  const weak = new Set();
  const seen = new Set([testFile]);
  const queue = [testFile];
  const loaders = new Set();
  while (queue.length > 0) {
    const file = queue.pop();
    const { edges, refs, dynamic, loaders: found } = analyze(file);
    for (const name of found) loaders.add(name);
    // Reaching any unresolvable file (test, helper, src, script) means the
    // real dependencies are unknown, so the test always runs.
    if (dynamic) return null;
    if (changed.includes(file)) hit.add(file);
    for (const ref of refs) {
      for (const c of changed) {
        if (c === ref.ref) hit.add(c);
        else if (refMatches(ref, c)) weak.add(c);
      }
    }
    for (const next of edges) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  // A loader shim is only safe while every call names its file with a literal.
  for (const file of seen) {
    if (loaders.size === 0) break;
    if (!file.startsWith("tests/")) continue;
    const { text } = analyze(file);
    for (const name of loaders) if (callsWithUnknownPath(file, text, name, loaders)) return null;
  }
  return { hit, weak };
}

const isTest = (file) => /^tests\/.*\.test\.(cjs|ts)$/.test(file);

// The result is interpolated into a shell command line, and a PR controls the
// filenames it adds. Anything outside this set is not passed through.
const isShellSafe = (file) => /^[A-Za-z0-9._/-]+$/.test(file);

export async function selectTests(changed) {
  const files = changed.map((f) => f.trim()).filter(Boolean);
  if (files.length === 0) return "ALL";
  if (files.length > TOTAL_CHANGE_THRESHOLD) return "ALL";
  if (files.some((f) => WIDE_PATTERNS.some((p) => p.test(f)))) return "ALL";
  for (const dir of WIDE_FANOUT_DIRS) {
    if (files.filter((f) => dir.test(f)).length > WIDE_FANOUT_THRESHOLD) {
      return "ALL";
    }
  }

  // The inventory is the runner's own list, so a deleted or renamed test never
  // reaches it and nested suites (tests/security/) are included.
  const { supported } = await discoverTestFiles({ root, testsRoot });
  const inventory = new Set(supported);
  const tests = supported.map((file) => [
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
  ]);
  const sources = files.filter((f) => !isTest(f));
  const reachable = new Map(supported.map((t) => [t, reaches(t, sources)]));
  const changedTests = new Set(files.filter((f) => isTest(f) && inventory.has(f)));
  const selected = new Set(changedTests);
  // Directory and prefix references (a test that scans a folder) select a test
  // but are not proof that the file is covered, and a test with an unresolvable
  // require runs for every change: neither may end the ALL check below.
  const weak = new Set();

  for (const file of files) {
    if (isTest(file)) continue;
    // Match on the repo-relative path only. A basename stem also matches tests
    // that merely mention the word, which reads as coverage the file does not
    // have.
    const matches = tests.filter(
      ([t, contents]) =>
        contents.includes(file) ||
        (reachable.get(t) !== null && reachable.get(t).hit.has(file)),
    );
    // Nothing references this file, so the heuristic has no opinion about it.
    // Judged per file, and tests changed by this PR do not count: a test that
    // merely names the file would otherwise buy the PR out of the suite.
    if (matches.every(([t]) => changedTests.has(t))) return "ALL";
    for (const [testPath] of matches) selected.add(testPath);
    for (const [t] of tests) {
      if (reachable.get(t) !== null && reachable.get(t).weak.has(file)) weak.add(t);
    }
  }

  // No test mentions anything the PR touched: the heuristic has no opinion, so
  // fall back to the suite rather than reporting a vacuous green.
  if (selected.size === 0) return "ALL";

  for (const t of weak) selected.add(t);
  for (const [t] of tests) if (reachable.get(t) === null) selected.add(t);
  for (const file of ALWAYS) if (inventory.has(file)) selected.add(file);
  const result = [...selected].sort();
  // Dropping an unsafe path would quietly shrink the run; widen instead.
  return result.every(isShellSafe) ? result : "ALL";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const input = args.length > 0 ? args : fs.readFileSync(0, "utf8").split("\n");
  const result = await selectTests(input);
  console.log(result === "ALL" ? "ALL" : result.join("\n"));
}
