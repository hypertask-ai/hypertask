const { createHash } = require("node:crypto");

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
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SLOTS = ["primary", "repro"];

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
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

function journeyIds({ pages, bugfix = false } = {}) {
  const areas = (Array.isArray(pages) ? pages : []).map((item) => `area:${typeof item === "string" ? item : item?.page}`);
  return [...areas.filter((id) => id !== "area:undefined"), `change:${bugfix ? "repro" : "primary"}`];
}

function canonicalScript(actions, expect) {
  return JSON.stringify({ actions: Array.isArray(actions) ? actions : [], expect: Array.isArray(expect) ? expect : [] });
}

function scriptHash(actions, expect) {
  return sha256(canonicalScript(actions, expect));
}

function cacheKeyPrefix(baseSha) {
  if (!HEX40.test(String(baseSha))) throw new Error("base sha is not a sha");
  return `pstack-base-${baseSha}-`;
}

function cacheKey(baseSha, mapSha) {
  if (!HEX40.test(String(mapSha))) throw new Error("map sha is not a sha");
  return `${cacheKeyPrefix(baseSha)}${mapSha}`;
}

function validStep(step) {
  return !!step && typeof step === "object" && typeof step.ok === "boolean";
}

function parseCacheEntry(value) {
  let body;
  try {
    body = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!HEX40.test(String(body.baseSha)) || !HEX40.test(String(body.mapSha))) return null;
  if (!HEX64.test(String(body.scriptHash))) return null;
  if (typeof body.journey !== "string" || body.journey.length > 80) return null;
  if (typeof body.ok !== "boolean") return null;
  if (!Array.isArray(body.steps) || !Array.isArray(body.expects) || body.steps.length > 12 || body.expects.length > 12) return null;
  if (!body.steps.every(validStep) || !body.expects.every(validStep)) return null;
  if (!Array.isArray(body.navigations) || !Array.isArray(body.offOrigin)) return null;
  if (body.offOrigin.length) return null;
  if (!HEX64.test(String(body.pageHash ?? ""))) return null;
  if (typeof body.pageHash !== "string" || body.pageHash.length !== 64) return null;
  if (body.viewport != null && (typeof body.viewport !== "string" || !/^[a-z][a-z0-9-]{0,15}$/.test(body.viewport))) return null;
  const judged = body.judged && typeof body.judged === "object" ? body.judged : {};
  return {
    baseSha: body.baseSha,
    mapSha: body.mapSha,
    journey: body.journey,
    viewport: typeof body.viewport === "string" ? body.viewport : "",
    scriptHash: body.scriptHash,
    pageHash: body.pageHash,
    apiOnly: body.apiOnly === true,
    ok: body.ok,
    judged: ["PASS", "PASS+NOTES", "FAIL"].includes(judged.verdict) ? { verdict: judged.verdict } : { verdict: "" },
    steps: body.steps,
    expects: body.expects,
    navigations: body.navigations,
    offOrigin: [],
  };
}

function matchingEntry(entries, { baseSha, journey, scriptHash: wanted, mapSha }) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    const parsed = parseCacheEntry(entry);
    if (!parsed) continue;
    if (parsed.baseSha !== baseSha || parsed.mapSha !== mapSha) continue;
    if (parsed.journey !== journey || parsed.scriptHash !== wanted) continue;
    return parsed;
  }
  return null;
}

module.exports = {

  DISTINCTIVE_BASENAME,
  GENERIC_BASENAMES,
  SHARED_DIRS,
  apiPathOf,
  cacheKey,
  cacheKeyPrefix,
  canonicalScript,
  journeyIds,
  matchingEntry,
  pagesForFiles,
  parseCacheEntry,
  scriptHash,
  sha256,
};
