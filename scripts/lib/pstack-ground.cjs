const SEED_IDS = Object.freeze({ id: "1", task: "2", archived: "3", agent: "11111111-1111-4111-8111-111111111111" });
const TOKEN = /\{([^{}]*)\}/g;
const SOURCE_FILE = /^src\/.*\.(?:tsx|ts|jsx|js)$/;
const TEST_FILE = /(?:^tests?\/|\.test\.|\.spec\.)/;
const API_PAGE = /^src\/pages\/api\/.*\.(?:ts|tsx|js)$/;
const API_ROUTE = /^src\/app\/api\/.*\/route\.(?:ts|tsx|js)$/;
const DYNAMIC = /^\[[^[\]]+\]$/;
const OPTIONAL_CATCH_ALL = /^\[\[\.\.\..+\]\]$/;
const CATCH_ALL = /^\[\.\.\..+\]$/;
const ERROR_TEXT = /\b(?:error|invalid|fail(?:ed|s|ure)?|can'?t|cannot|could not|not allowed|forbidden|denied|unauthori[sz]ed|expired|too many|limit reached|went wrong)\b/i;
const CORPUS_LIMIT = 400000;

function stringsIn(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, found));
  return found;
}

function seed(value, ids = SEED_IDS) {
  return String(value).replace(TOKEN, (whole, name) => (name in ids ? String(ids[name]) : whole));
}

function tokenProblems(value) {
  const problems = [];
  for (const text of stringsIn(value)) {
    for (const [, name] of text.matchAll(TOKEN)) if (!(name in SEED_IDS)) problems.push(`{${name}} is not a seeded value`);
    if (/[{}]/.test(seed(text))) problems.push("a placeholder is still unfilled after seeding");
  }
  return problems;
}

function flat(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function grounded(corpus, text, extra) {
  const needle = flat(text).toLowerCase();
  if (!needle || needle.length < 2) return false;
  if (String(corpus).toLowerCase().includes(needle)) return true;
  return (Array.isArray(extra) ? extra : []).some((item) => flat(item).toLowerCase().includes(needle));
}

function routeSegments(file) {
  const tail = file.startsWith("src/app/api/")
    ? file.slice("src/app/api/".length).replace(/\/route\.(?:ts|tsx|js)$/, "")
    : file.slice("src/pages/api/".length).replace(/\.(?:ts|tsx|js)$/, "").replace(/\/index$/, "");
  return tail.split("/").filter(Boolean);
}

function routeMatches(parts, wanted) {
  let at = 0;
  for (const part of parts) {
    if (OPTIONAL_CATCH_ALL.test(part)) return true;
    if (CATCH_ALL.test(part)) return wanted.length - at >= 1;
    if (at >= wanted.length) return false;
    if (!DYNAMIC.test(part) && part.toLowerCase() !== wanted[at].toLowerCase()) return false;
    at += 1;
  }
  return at === wanted.length;
}

function apiPaths(paths) {
  return (Array.isArray(paths) ? paths : []).map(String).filter((file) => API_PAGE.test(file) || API_ROUTE.test(file));
}

function routeIn(paths, apiPath) {
  const wanted = seed(String(apiPath ?? "")).split("?")[0].split("/").filter(Boolean);
  if (wanted[0] !== "api" || wanted.length < 2) return false;
  return apiPaths(paths).some((file) => routeMatches(routeSegments(file), wanted.slice(1)));
}

function corpusOf(texts) {
  return Object.values(texts ?? {}).filter((text) => typeof text === "string").join("\n").slice(0, CORPUS_LIMIT);
}

function checkControl(action, { corpus, extra, readable }) {
  const name = action.op === "click" ? action.text : action.label;
  const testid = String(action.testid ?? "");
  if (!readable) return "";
  if (testid) {
    if (String(corpus).includes(`data-testid="${testid}"`)) return "";
    return `testid "${testid}" is not in the head source`;
  }
  if (name && grounded(corpus, name, extra)) return "";
  return `"${name}" is not in the head source`;
}

function checkAction(action, index, context) {
  const where = `step ${index + 1} ${String(action?.op ?? "?")}`;
  const tokens = tokenProblems(action);
  if (tokens.length) return { problem: `${where}: ${tokens[0]}` };
  if (action.op === "click" || action.op === "fill") {
    const named = checkControl(action, context);
    return named ? { problem: `${where}: ${named}` } : { problem: "" };
  }
  if (action.op !== "api") return { problem: "" };
  if (context.routes.length && !routeIn(context.routes, action.path)) return { problem: `${where}: ${String(action.path)} is not a route in the head source` };
  if (action.expectText && context.readable && !grounded(context.corpus, action.expectText, context.extra)) return { problem: `${where}: "${action.expectText}" is not in the head source` };
  if (Number(action.expectStatus) >= 400 && !flat(action.force)) return { dropped: `${where}: expects HTTP ${action.expectStatus} and names no way to force it` };
  return { problem: "" };
}

function checkExpect(expect, index, context) {
  const where = `expect ${index + 1}`;
  const tokens = tokenProblems(expect);
  if (tokens.length) return { problem: `${where}: ${tokens[0]}` };
  if (expect.text && ERROR_TEXT.test(expect.text) && !flat(expect.force)) return { dropped: `${where}: expects an error and names no way to force it` };
  if (expect.text && context.readable && !grounded(context.corpus, expect.text, context.extra)) return { problem: `${where}: "${expect.text}" is not in the head source` };
  return { problem: "" };
}

function checkJourney(item, context) {
  const actions = [], expects = [], problems = [], dropped = [];
  const name = String(item?.journey ?? "change:primary");
  for (const [index, action] of (Array.isArray(item?.actions) ? item.actions : []).entries()) {
    const checked = checkAction(action, index, context);
    if (checked.problem) problems.push(`${name} ${checked.problem}`);
    if (checked.dropped) dropped.push(`${name} ${checked.dropped}`);
    if (!checked.dropped) actions.push(action);
  }
  for (const [index, expect] of (Array.isArray(item?.expect) ? item.expect : []).entries()) {
    const checked = checkExpect(expect, index, context);
    if (checked.problem) problems.push(`${name} ${checked.problem}`);
    if (checked.dropped) dropped.push(`${name} ${checked.dropped}`);
    if (!checked.dropped) expects.push(expect);
  }
  return { journey: { ...item, journey: name, actions, expect: expects }, problems, dropped };
}

function review({ journeys, corpus = "", routes = [], fixtures = "" } = {}) {
  const list = Array.isArray(journeys) ? journeys : [];
  const values = list.flatMap((item) => (item?.actions ?? []).map((action) => action?.value).filter((value) => typeof value === "string" && value.length > 1));
  const context = { corpus: String(corpus ?? ""), routes: Array.isArray(routes) ? routes : [], extra: [fixtures, ...values].filter(Boolean), readable: flat(corpus).length > 0 };
  const checked = [], problems = [], dropped = [];
  for (const item of list) {
    const result = checkJourney(item, context);
    checked.push(result.journey);
    problems.push(...result.problems);
    dropped.push(...result.dropped);
  }
  return { journeys: checked, problems, dropped: dropped.map((text) => `${text} (dropped)`), readable: context.readable };
}

module.exports = {
  CORPUS_LIMIT,
  SEED_IDS,
  SOURCE_FILE,
  TEST_FILE,
  corpusOf,
  review,
  routeIn,
  seed,
};
