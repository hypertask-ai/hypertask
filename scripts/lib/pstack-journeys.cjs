const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

const FLAG_FILE = /^src\/lib\/flags\/definitions\/(htpr-\d+-[a-z0-9-]+)\.ts$/;
const FLAG_KEY = /\bhtpr-\d+-[a-z0-9-]+/g;
const SHARED_DIRS = [
  "src/lib/flags/definitions/",
  "src/lib/",
  "src/utils/",
  "src/components/",
  "src/pages/api/",
  "src/styles/",
  "src/app/",
  "scripts/",
  "tests/",
];
const GENERIC_BASENAMES = new Set([
  "page.tsx",
  "page.ts",
  "route.ts",
  "route.tsx",
  "layout.tsx",
  "loading.tsx",
  "error.tsx",
  "index.ts",
  "types.ts",
  "utils.ts",
  "globals.scss",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "README.md",
  "SKILL.md",
]);
const DISTINCTIVE_BASENAME = /^[a-z0-9]+(?:-[a-z0-9]+){1,}\.(?:tsx|ts|jsx|js|scss|md)$/;
const TEST_PATH = /^tests?\//;
const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const PRODUCT_EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);
const NON_PRODUCT = [
  /^(?:docs?|documentation)\//,
  /\.(?:md|mdx|txt|rst|adoc|json|yml|yaml|css|scss|snap|png|jpg|jpeg|svg|gif|webp|ico)$/,
  /^(?:changelog\.d|changelog|news)\//,
  /^CHANGELOG/,
  /^(?:\.github|\.circleci|\.buildkite|ci)\//,
  /^(?:tests?|__tests__|spec|evals?|verification|e2e|fixtures)\//,
  /(?:^|\/)(?:test|spec)_[^/]+$|\.(?:test|spec)\.[^/]+$|(?:^|\/)conftest\.py$/,
  /^(?:LICENSE|NOTICE|COPYING|AUTHORS)(?:\.\w+)?$|^\.(?:gitignore|gitattributes|editorconfig|prettierrc|eslintrc)$/,
];
const NAMED_LIMIT = 10;
const SURFACE_FILE = /^src\/(?:pages\/|app\/)/;
const TRACE_HOPS = 2;
const ROUTE_HOPS = 4;
const HUB_IMPORTERS = 30;
const TRACE_LIMIT = 6;
const APP_ROUTE = /^src\/app\/(?!api\/)/;
const PAGE_FILE = /^page\.(?:tsx|ts|jsx|js)$/;
const NOT_A_SCREEN = /^(?:layout|template|error|global-error|not-found|loading|default)\.(?:tsx|ts|jsx|js)$/;
const ROUTE_GROUP = /^\(.*\)$/;
const CATCH_ALL = /^\[\[\.\.\..*\]\]$|^\[\.\.\..*\]$/;
const DYNAMIC = /^\[\[?.+?\]\]?$/;
const SEED_PARAM = { agentid: "{agent}", projectid: "{id}" };

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function normalizePages(pages) {
  return (Array.isArray(pages) ? pages : [])
    .map((page) => ({ name: String(page?.name ?? ""), text: String(page?.text ?? "") }))
    .filter((page) => page.name.length > 0 && page.name !== "INDEX");
}

function apiPathOf(file) {
  const match = /^src\/pages\/(api\/.+?)(?:\.ts|\.tsx)?$/.exec(file);
  if (!match) return "";
  return `/${match[1].replace(/\/index$/, "")}`;
}

function pageScore(page, { files, flagKeys, sharedDirs }) {
  let best = 0;
  for (const file of files) {
    if (TEST_PATH.test(file) || file.startsWith("scripts/")) continue;
    const base = file.slice(file.lastIndexOf("/") + 1);
    const flagFile = FLAG_FILE.exec(file);
    const dir = file.slice(0, file.lastIndexOf("/") + 1);
    const api = apiPathOf(file);
    let score = 0;
    if (page.text.includes(file)) score = 3;
    else if (api && page.text.includes(api)) score = 3;
    else if (flagFile && (page.text.includes(flagFile[1]) || page.text.includes(flagFile[1].replace(/^htpr-\d+-/, "")))) score = 4;
    else if (dir && !sharedDirs.has(dir) && page.text.includes(dir)) score = 2;
    else if (DISTINCTIVE_BASENAME.test(base) && page.text.includes(base)) score = 1;
    if (score > best) best = score;
  }
  if (best < 3 && flagKeys.some((key) => page.text.includes(key))) best = 3;
  return best;
}

function changedLines(diff) {
  return String(diff ?? "")
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(?:\+\+\+|---)/.test(line))
    .join("\n");
}

function pagesForFiles({ files, diff = "", pages } = {}) {
  const list = uniqueSorted((Array.isArray(files) ? files : []).map(String));
  const flagKeys = uniqueSorted(changedLines(diff).match(FLAG_KEY) ?? []);
  const sharedDirs = new Set(SHARED_DIRS);
  return normalizePages(pages)
    .map((page) => ({ page: page.name, score: pageScore(page, { files: list, flagKeys, sharedDirs }) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.page.localeCompare(right.page));
}

function moduleKey(file) {
  return String(file).replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");
}

function importSpecifiers(text) {
  const specs = new Set();
  const pattern = /(?:from\s+|require\(\s*|import\(\s*|import\s+)["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(String(text ?? "")))) specs.add(match[1]);
  return [...specs];
}

function runtimeImportSpecifiers(text) {
  const source = String(text ?? "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (token) => token.startsWith("/") ? " " : token);
  const pattern = /\b(?:import|export)\b\s*(type\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)|(?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)|[\w$]+)\s*from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s+type\s+[\w$]+\s*=\s*require\s*\([^)]*\)|\b(require|import)\s*\(\s*["']([^"']+)["']\s*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
  const specs = new Set();
  for (const match of source.matchAll(pattern)) {
    if (match[1]) {
      const clause = match[1].trim();
      const members = /^\{([^}]*)\}$/.exec(clause)?.[1].split(",").map((item) => item.trim()).filter(Boolean);
      if (/^type\s/.test(clause) || (members?.length && members.every((item) => /^type\s+(?!as\b)[\w$]+/.test(item)))) continue;
      specs.add(match[2]);
    } else if (match[3]) specs.add(match[3]);
    else if (match[4]) {
      const before = source.slice(0, match.index);
      const after = source.slice(match.index + match[0].length);
      if (match[4] === "import" && (/\btypeof\s*$/.test(before) || /^\s*\.\s*(?!(?:then|catch|finally)\b)[\w$]+/.test(after))) continue;
      specs.add(match[5]);
    }
  }
  return [...specs];
}

function appDirKey(dir) {
  const parts = String(dir).slice("src/app".length).split("/").filter((part) => part && !ROUTE_GROUP.test(part));
  return ["src/app", ...parts].join("/");
}

function pageRouteDirs(sources) {
  const dirs = new Set();
  for (const entry of Array.isArray(sources) ? sources : []) {
    const file = String(entry);
    if (!APP_ROUTE.test(file) || !PAGE_FILE.test(file.slice(file.lastIndexOf("/") + 1))) continue;
    dirs.add(appDirKey(path.posix.dirname(file)));
  }
  return dirs;
}

function routeBase(dir, pageDirs) {
  let current = String(dir);
  while (current === "src/app" || current.startsWith("src/app/")) {
    if (pageDirs.has(appDirKey(current))) return current;
    current = path.posix.dirname(current);
  }
  return "";
}

function routeSegments(dir) {
  return String(dir).slice("src/app/".length).split("/").filter((part) => part && !ROUTE_GROUP.test(part));
}

function seededPath(prefix, boardPath, taskPath, optional) {
  const usable = (value) => typeof value === "string" && value.startsWith("/");
  if (!prefix.length) return usable(boardPath) ? boardPath : usable(taskPath) ? taskPath : "";
  const want = prefix.join("/").toLowerCase();
  for (const value of [taskPath, boardPath]) {
    if (!usable(value)) continue;
    const parts = value.split("?")[0].replace(/^\//, "").toLowerCase().split("/");
    if (parts.length > prefix.length && parts.slice(0, prefix.length).join("/") === want) return value;
  }
  return optional ? `/${prefix.join("/")}` : "";
}

function appRoute(file, { boardPath = "", taskPath = "", pageDirs = new Set() } = {}) {
  if (!APP_ROUTE.test(file) || NOT_A_SCREEN.test(String(file).slice(String(file).lastIndexOf("/") + 1))) return "";
  const dir = routeBase(path.posix.dirname(file), pageDirs);
  if (!dir) return "";
  const parts = [];
  for (const segment of routeSegments(dir)) {
    if (CATCH_ALL.test(segment)) return seededPath(parts, boardPath, taskPath, segment.startsWith("[["));
    const named = DYNAMIC.test(segment) ? SEED_PARAM[segment.replace(/[[\]]/g, "").toLowerCase()] : null;
    if (DYNAMIC.test(segment) && !named) return "";
    parts.push(named || segment);
  }
  return `/${parts.join("/")}`;
}

function importPath(from, spec) {
  const value = String(spec);
  if (value.startsWith("@/")) return path.posix.join("src", value.slice(2));
  if (!value.startsWith(".")) return "";
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), value));
}

function importKey(from, spec) {
  return moduleKey(importPath(from, spec));
}

function defaultSources() {
  try {
    return readdirSync("src", { recursive: true }).map((name) => path.posix.join("src", String(name))).filter((file) => SOURCE_EXT.includes(path.extname(file)));
  } catch {
    return [];
  }
}

function defaultReadSource(file) {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

function reverseImports(sources, readSource) {
  const reverse = new Map();
  for (const file of sources) {
    const text = readSource(file);
    if (!text) continue;
    for (const spec of importSpecifiers(text)) {
      const key = importKey(file, spec);
      if (!key) continue;
      const list = reverse.get(key) ?? [];
      if (!list.includes(file)) list.push(file);
      reverse.set(key, list);
    }
  }
  return reverse;
}

function routeEntries({ changed, reverse, pages, boardPath, taskPath, pageDirs }) {
  const seeded = { boardPath, taskPath, pageDirs };
  const named = normalizePages(pages);
  const found = new Map();
  const seen = new Set();
  let frontier = [];
  for (const file of changed) {
    const route = appRoute(file, seeded);
    if (route) found.set(route, { file, route });
    seen.add(moduleKey(file));
    frontier.push(file);
  }
  for (let hop = 1; hop <= ROUTE_HOPS && frontier.length; hop += 1) {
    const next = [];
    for (const file of frontier) {
      const importers = reverse.get(moduleKey(file)) ?? [];
      if (importers.length > HUB_IMPORTERS) continue;
      for (const importer of importers) {
        const key = moduleKey(importer);
        if (seen.has(key)) continue;
        seen.add(key);
        const route = appRoute(importer, seeded);
        if (route && !found.has(route)) found.set(route, { file: importer, route });
        if (!PAGE_FILE.test(path.posix.basename(importer))) next.push(importer);
      }
    }
    frontier = next;
  }
  return [...found.values()].map((entry) => ({ ...entry, pages: pagesForFiles({ files: [entry.file], pages: named }).map((item) => item.page).slice(0, 3) }));
}

function traceImports({ files, pages = [], sources, readSource = defaultReadSource, boardPath = "", taskPath = "" } = {}) {
  const changed = uniqueSorted((Array.isArray(files) ? files : []).map(String))
    .filter((file) => file.startsWith("src/") && !TEST_PATH.test(file) && SOURCE_EXT.includes(path.extname(file)));
  const listed = Array.isArray(sources) ? sources : changed.length ? defaultSources() : [];
  const reverse = changed.length ? reverseImports(listed, readSource) : new Map();
  const surfaces = new Map();
  for (const file of changed) {
    if (SURFACE_FILE.test(file)) surfaces.set(file, { via: [file], depth: 0 });
    let queue = [{ file, via: [file] }];
    const seen = new Set([moduleKey(file)]);
    for (let hop = 0; hop < TRACE_HOPS && queue.length; hop += 1) {
      const next = [];
      for (const node of queue) {
        const importers = reverse.get(moduleKey(node.file)) ?? [];
        if (importers.length > HUB_IMPORTERS) continue;
        for (const importer of importers) {
          const key = moduleKey(importer);
          if (seen.has(key)) continue;
          seen.add(key);
          const via = [...node.via, importer];
          if (SURFACE_FILE.test(importer)) {
            const held = surfaces.get(importer);
            if (!held || held.via.length > via.length) surfaces.set(importer, { via, depth: via.length });
          } else next.push({ file: importer, via });
        }
      }
      queue = next;
    }
  }
  const ordered = [...surfaces.entries()].sort((left, right) => left[1].depth - right[1].depth || left[0].localeCompare(right[0]));
  const named = normalizePages(pages);
  const routes = changed.length ? routeEntries({ changed, reverse, pages: named, boardPath, taskPath, pageDirs: pageRouteDirs(listed) }) : [];
  return {
    routes,
    surfaces: ordered.slice(0, TRACE_LIMIT).map(([file, entry]) => ({
      file,
      via: entry.via,
      pages: pagesForFiles({ files: [file], pages: named }).map((item) => item.page).slice(0, 3),
    })),
  };
}

function journeyIds({ pages, bugfix = false } = {}) {
  const areas = (Array.isArray(pages) ? pages : []).map((item) => `area:${typeof item === "string" ? item : item?.page}`);
  return [...areas.filter((id) => id !== "area:undefined"), `change:${bugfix ? "repro" : "primary"}`];
}

function repoPath(file) {
  return String(file ?? "").trim().replace(/^\.\//, "");
}

function currentFiles(files) {
  return (Array.isArray(files) ? files : []).filter((file) => file?.status !== "removed").map((file) => repoPath(typeof file === "string" ? file : file?.filename)).filter(Boolean);
}

function productChanged(files) {
  return uniqueSorted(currentFiles(files))
    .filter((file) => file.startsWith("src/") && PRODUCT_EXT.has(path.extname(file)))
    .filter((file) => !TEST_PATH.test(file) && !/\.(?:test|spec)\.[^/]+$/.test(file));
}

function notProduct(file) {
  const name = repoPath(file);
  return NON_PRODUCT.some((pattern) => pattern.test(name));
}

function recordedUncovered(unmapped) {
  return uniqueSorted((Array.isArray(unmapped) ? unmapped : []).map(repoPath).filter(Boolean).filter((file) => !notProduct(file)));
}

const RESOLVE_EXT = [...SOURCE_EXT, ...SOURCE_EXT.map((ext) => `/index${ext}`)];

function resolveSource(key, readSource) {
  if (!key) return "";
  for (const candidate of [key, ...RESOLVE_EXT.map((ext) => `${key}${ext}`)]) {
    if (readSource(candidate) !== "") return candidate;
  }
  return "";
}

function importClosure({ roots = [], readSource = defaultReadSource } = {}) {
  const seen = new Set();
  const covered = new Set();
  const queue = (Array.isArray(roots) ? roots : []).map(String);
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    covered.add(file);
    const text = readSource(file);
    if (!text) continue;
    for (const spec of runtimeImportSpecifiers(text)) {
      const target = resolveSource(importPath(file, spec), readSource);
      if (target) queue.push(target);
    }
  }
  return covered;
}

function uncoveredFiles({ files = [], unmapped = [], surfaces = [], routes = [], readSource = defaultReadSource } = {}) {
  const roots = uniqueSorted([...surfaces, ...routes].map((item) => repoPath(item?.file ?? item)).filter(Boolean));
  const covered = importClosure({ roots: roots.filter((file) => readSource(file) !== ""), readSource });
  const obsolete = new Set((Array.isArray(files) ? files : []).flatMap((file) => typeof file === "object" && file ? [file.previous_filename, ...(file.status === "removed" ? [file.filename] : [])] : []).filter(Boolean));
  const walked = productChanged(files).filter((file) => !covered.has(file));
  return uniqueSorted([...recordedUncovered(unmapped).filter((file) => !obsolete.has(file)), ...walked]);
}

function journeyRoots({ sources = defaultSources(), boardPath = "", taskPath = "" } = {}) {
  const pageDirs = pageRouteDirs(sources);
  const listed = new Set(sources);
  const entries = sources.filter((file) => PAGE_FILE.test(path.posix.basename(file)) || /^src\/(?:app|pages)\/api\//.test(file)).map((file) => ({ file, route: appRoute(file, { boardPath, taskPath, pageDirs }) }));
  return entries.flatMap((entry) => {
    const roots = [entry];
    if (!entry.route) return roots;
    for (let dir = path.posix.dirname(entry.file); dir === "src/app" || dir.startsWith("src/app/"); dir = path.posix.dirname(dir)) {
      for (const ext of SOURCE_EXT) if (listed.has(`${dir}/layout${ext}`)) roots.push({ file: `${dir}/layout${ext}`, route: entry.route });
    }
    return roots;
  });
}

function uncoveredReason(paths) {
  const named = paths.slice(0, NAMED_LIMIT).join(", ");
  const more = paths.length > NAMED_LIMIT ? ` and ${paths.length - NAMED_LIMIT} more` : "";
  return `FAIL: ${paths.length} changed product file${paths.length === 1 ? "" : "s"} no planned journey exercises: ${named}${more}. Add or select a journey that exercises ${paths.length === 1 ? "it" : "them"}, then re-run the verifier.`;
}

function uncoveredPassGate(verdict, { unmapped = [] } = {}) {
  if (verdict !== "PASS" && verdict !== "PASS+NOTES") return { verdict, notes: "", uncovered: [], demoted: false };
  const uncovered = recordedUncovered(unmapped);
  if (!uncovered.length) return { verdict, notes: "", uncovered: [], demoted: false };
  return { verdict: "FAIL", notes: uncoveredReason(uncovered), uncovered, demoted: true };
}

module.exports = {
  DISTINCTIVE_BASENAME,
  GENERIC_BASENAMES,
  SHARED_DIRS,
  apiPathOf,
  currentFiles,
  importClosure,
  journeyIds,
  journeyRoots,
  notProduct,
  pagesForFiles,
  productChanged,
  traceImports,
  uncoveredFiles,
  uncoveredPassGate,
  uncoveredReason,
};
