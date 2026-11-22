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
const SURFACE_FILE = /^src\/(?:pages\/|app\/)/;
const TRACE_HOPS = 2;
const HUB_IMPORTERS = 30;
const TRACE_LIMIT = 6;

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
    if (TEST_PATH.test(file)) continue;
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

function importKey(from, spec) {
  const value = String(spec);
  if (value.startsWith("@/")) return moduleKey(path.posix.join("src", value.slice(2)));
  if (!value.startsWith(".")) return "";
  return moduleKey(path.posix.normalize(path.posix.join(path.posix.dirname(from), value)));
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

function traceImports({ files, pages = [], sources, readSource = defaultReadSource } = {}) {
  const changed = uniqueSorted((Array.isArray(files) ? files : []).map(String))
    .filter((file) => file.startsWith("src/") && !TEST_PATH.test(file) && SOURCE_EXT.includes(path.extname(file)));
  const reverse = changed.length ? reverseImports(Array.isArray(sources) ? sources : defaultSources(), readSource) : new Map();
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
  return {
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

module.exports = {
  DISTINCTIVE_BASENAME,
  GENERIC_BASENAMES,
  SHARED_DIRS,
  apiPathOf,
  journeyIds,
  pagesForFiles,
  traceImports,
};
