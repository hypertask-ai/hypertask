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
const DYNAMIC_RE = /\b(?:require|import)\((?!\s*(?:["'`]|(?:path\.)?(?:join|resolve)\())/;

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
  const result = { edges: new Set(), refs: [], dynamic: false };
  analysisCache.set(file, result);
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, file), "utf8");
  } catch {
    return result;
  }
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) return result;
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
  // Loader shims call require(request) for a module named by a literal path
  // elsewhere in the file; only a file with no path at all is unresolvable.
  result.dynamic = result.refs.length === 0 && DYNAMIC_RE.test(text);
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
  while (queue.length > 0) {
    const file = queue.pop();
    const { edges, refs, dynamic } = analyze(file);
    if (dynamic && file.startsWith("tests/")) return null;
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
