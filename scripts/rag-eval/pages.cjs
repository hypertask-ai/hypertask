const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const ts = require("typescript");

const PAGE_FIELDS = ["title", "contentText", "searchText"];
const PAGE_TOP_K = 10;
const RANKED_LIMIT = 50;
const K1 = 1.2;
const B = 0.75;
const BOARD_ID = 15;
const USER_ID = 985;

function matchesFilter(row, filter) {
  if (!filter) return true;
  const [field, operator, value] = filter;
  if (field === "And") return operator.every((part) => matchesFilter(row, part));
  if (operator === "Eq") return row[field] === value;
  if (operator === "NotEq") return row[field] !== value;
  if (operator === "In") return value.includes(row[field]);
  throw new Error(`Unsupported fixture filter: ${JSON.stringify(filter)}`);
}

function buildPageIndex(rows, tokenize) {
  const stats = {};
  for (const field of PAGE_FIELDS) {
    const postings = new Map();
    let total = 0;
    for (const row of rows) {
      const tokens = tokenize(row[field]);
      row[`${field}Length`] = tokens.length;
      total += tokens.length;
      for (const token of tokens) {
        if (!postings.has(token)) postings.set(token, new Map());
        postings.get(token).set(row.id, (postings.get(token).get(row.id) ?? 0) + 1);
      }
    }
    stats[field] = { postings, avgLength: total / (rows.length || 1) };
  }
  return { stats, size: rows.length };
}

function pageFieldScores(index, pool, spec, tokenize) {
  if (spec[0] === "Sum") {
    const totals = new Map();
    for (const child of spec[1]) {
      for (const [id, value] of pageFieldScores(index, pool, child, tokenize)) totals.set(id, (totals.get(id) ?? 0) + value);
    }
    return totals;
  }
  if (spec[0] === "Product") {
    const [weight, child] = spec[1];
    return new Map([...pageFieldScores(index, pool, child, tokenize)].map(([id, value]) => [id, value * weight]));
  }
  const [field, operator, text, options] = spec;
  if (operator !== "BM25") throw new Error(`Unsupported fixture ranking: ${JSON.stringify(spec)}`);
  const { postings, avgLength } = index.stats[field];
  const queryTokens = tokenize(text);
  const last = queryTokens[queryTokens.length - 1];
  const lengths = new Map(pool.map((row) => [row.id, row[`${field}Length`]]));
  const scores = new Map();
  for (const token of new Set(queryTokens)) {
    const matched = options?.last_as_prefix && token === last && token.length >= 2
      ? [...postings.keys()].filter((candidate) => candidate.startsWith(token))
      : postings.has(token) ? [token] : [];
    if (!matched.length) continue;
    const holders = new Set(matched.flatMap((candidate) => [...postings.get(candidate).keys()]));
    const idf = Math.log(1 + (index.size - holders.size + 0.5) / (holders.size + 0.5));
    for (const candidate of matched) {
      for (const [id, frequency] of postings.get(candidate)) {
        const length = lengths.get(id) ?? 0;
        const weight = (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / (avgLength || 1)));
        scores.set(id, (scores.get(id) ?? 0) + idf * weight);
      }
    }
  }
  return scores;
}

function pageDocuments(corpus) {
  return corpus.pages.map((page) => ({
    ...page,
    id: String(page.id),
    projectTitle: page.projectId === BOARD_ID ? "Hypertask Product" : "Other Board",
    searchText: [page.title, page.contentText].filter(Boolean).join(" "),
  }));
}

function matchPageWhere(row, where) {
  if (!where) return true;
  if (where.OR && !where.OR.some((clause) => matchPageWhere(row, clause))) return false;
  for (const [field, condition] of Object.entries(where)) {
    if (field === "OR") continue;
    if (field === "project") {
      if (condition.status && row.projectStatus !== condition.status) return false;
      continue;
    }
    if (field === "taskId") {
      if (condition.not === null && row.taskId === null) return false;
      continue;
    }
    if (field === "id" && condition.in) {
      if (!condition.in.map(String).includes(String(row.id))) return false;
      continue;
    }
    if (field === "projectId" && condition.in) {
      if (!condition.in.includes(row.projectId)) return false;
      continue;
    }
    if (field === "archived") {
      if (row.archived !== condition) return false;
      continue;
    }
    if (field === "title" || field === "contentText") {
      if (!String(row[field] ?? "").toLowerCase().includes(String(condition.contains).toLowerCase())) return false;
      continue;
    }
    throw new Error(`Unsupported fixture page filter: ${field} ${JSON.stringify(condition)}`);
  }
  return true;
}

function createPageReplay({ corpus, tokenize }) {
  const rows = pageDocuments(corpus);
  const index = buildPageIndex(rows, tokenize);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const state = { flagOn: false, trace: [] };
  const cache = new Map();

  function execute(plan) {
    state.trace.push({ plan: JSON.parse(JSON.stringify(plan)) });
    if (!plan.queries) return { rows: ranked(plan) };
    if (plan.rerank_by?.[0] !== "RRF") throw new Error("Unsupported fixture fusion");
    throw new Error("Page hybrid replay needs embeddings, which this fixture set does not carry");
  }

  function ranked(plan) {
    const pool = rows.filter((row) => matchesFilter(row, plan.filters));
    const scores = pageFieldScores(index, pool, plan.rank_by, tokenize);
    return pool
      .filter((row) => (scores.get(row.id) ?? 0) > 0)
      .sort((left, right) => scores.get(right.id) - scores.get(left.id) || left.id.localeCompare(right.id))
      .slice(0, plan.top_k)
      .map((row) => ({
        id: row.id,
        title: row.title,
        contentText: row.contentText,
        projectId: row.projectId,
        projectTitle: row.projectTitle,
        updatedAt: row.updatedAt,
      }));
  }

  const prisma = {
    page: {
      findMany: async ({ where, orderBy }) => rows
        .filter((row) => matchPageWhere(row, where))
        .sort((left, right) => orderBy?.updatedAt === "desc" ? String(right.updatedAt).localeCompare(String(left.updatedAt)) : 0)
        .slice(0, RANKED_LIMIT)
        .map((row) => ({
          id: Number(row.id),
          publicId: `fixture-${row.id}`,
          title: row.title,
          contentText: row.contentText,
          projectId: row.projectId,
          parentPageId: null,
          updatedAt: row.updatedAt,
          task: row.taskId !== null && row.taskStatus === "Normal" && row.projectStatus === "Normal" ? { id: row.taskId } : null,
        })),
    },
  };

  const stubs = {
    "@prisma/client": {},
    "@/lib/prisma": { default: prisma, __esModule: true },
    "@/lib/flags": { isFeatureEnabled: async () => state.flagOn },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": () => load("src/utils/controllers/turbopuffer/turbopufferHelper.ts"),
    "@/utils/controllers/search/rankHits": () => load("src/utils/controllers/search/rankHits.ts"),
    "@/lib/turbopuffer": {
      __esModule: true,
      default: { namespace: (name) => ({ query: async (plan) => {
        if (name !== "pages-v2") throw new Error(`Unexpected fixture namespace: ${name}`);
        return execute(plan);
      } }) },
      turbopufferNamespaces: { page: { name: "pages-v2" } },
    },
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/app/api/ai/_lib/boardMemoryContract": { buildCustomInstructionSearchFilters: () => { throw new Error("Unexpected custom instruction search"); } },
    "@/lib/ai/spend/embeddingRoute": { embeddingSpendMode: async () => ({ mode: "keyword" }), withSpendCharge: async (_route, _team, _inputs, run) => run() },
    "@/utils/helperFunctions/markdownToHtml": { markdownToHtml: (value) => value },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (value) => value },
    "./htmlCanvas": { decodeHtmlCanvas: () => "", extractCanvasText: () => "", wrapHtmlCanvas: (value) => value },
  };

  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const source = readFileSync(join(__dirname, "../..", file), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const localRequire = (request) => {
      if (Object.hasOwn(stubs, request)) {
        const stub = stubs[request];
        if (typeof stub === "function") return stub();
        return request === "@/lib/prisma" ? stub.default : stub;
      }
      if (request.startsWith("@/lib/flags/definitions/")) return load(`${request.slice(2)}.ts`);
      if (["crypto", "node-html-parser"].includes(request)) return require(request);
      throw new Error(`Unexpected production dependency: ${request} (${file})`);
    };
    new Function("require", "module", "exports", "fetch", "process", code)(
      localRequire,
      loaded,
      loaded.exports,
      async () => { throw new Error("Page replay never calls a paid model"); },
      { env: {} }
    );
    return loaded.exports;
  }

  return {
    rows,
    trace: state.trace,
    async retrieve({ query, mode }) {
      state.flagOn = mode === "index";
      state.trace.length = 0;
      const result = await load("src/utils/controllers/pages/pageService.ts").searchPages({
        query,
        projectIds: [BOARD_ID],
        userId: USER_ID,
        agentId: null,
        teamScope: null,
      });
      return result.map((page) => page.id);
    },
  };
}

function validatePageFixtures(corpus, queries) {
  const problems = [];
  const known = new Set(corpus.pages.filter((page) => page.projectId === BOARD_ID).map((page) => page.id));
  const pairs = queries.pairs ?? [];
  const answerPairs = pairs.filter((pair) => pair.kind === "paraphrase");
  if (corpus.boardId !== BOARD_ID || queries.boardId !== BOARD_ID) problems.push("page fixtures must come from board 15");
  if (answerPairs.length < 15) problems.push(`only ${answerPairs.length} page pairs, need at least 15`);
  if (!pairs.some((pair) => pair.kind === "access_probe")) problems.push("no access probes, the project filter is not measured");
  if (!corpus.pages.some((page) => page.projectId !== BOARD_ID)) problems.push("no page outside the board, the project filter cannot be measured");
  if (!corpus.pages.every((page) => page.archived === false)) problems.push("archived pages are not searched here, remove them from the corpus");
  const ids = new Set();
  for (const pair of pairs) {
    if (!pair.id || ids.has(pair.id)) problems.push(`page pair id missing or repeated: ${pair.id}`);
    ids.add(pair.id);
    if (!pair.query || pair.query.trim().length < 8) problems.push(`${pair.id} has no usable query`);
    for (const page of pair.expected ?? []) if (!known.has(page)) problems.push(`${pair.id} expects page ${page}, which is not an accessible page`);
    for (const page of pair.notExpected ?? []) if (known.has(page)) problems.push(`${pair.id} calls page ${page} outside the board, but it is inside`);
  }
  return problems;
}

function pageScore(pair, rankedIds) {
  const position = rankedIds.slice(0, PAGE_TOP_K).findIndex((id) => pair.expected.includes(id));
  const rank = position < 0 ? null : position + 1;
  return { id: pair.id, rank, hit: rank !== null, mrr: rank ? 1 / rank : 0 };
}

const round = (value) => Math.round(value * 1000) / 1000;

async function measurePages({ corpus, queries }, { tokenize }) {
  const problems = validatePageFixtures(corpus, queries);
  if (problems.length) throw new Error(`page test set is not valid:\n- ${problems.join("\n- ")}`);
  const replay = createPageReplay({ corpus, tokenize });
  const answerPairs = queries.pairs.filter((pair) => pair.kind === "paraphrase");
  const probePairs = queries.pairs.filter((pair) => pair.kind === "access_probe");
  const result = { pages: replay.rows.length, pairs: answerPairs.length, probes: probePairs.length, board: BOARD_ID, backend: "offline page-service entry-point replay", modes: {} };
  for (const mode of ["literal", "index"]) {
    const scored = [];
    for (const pair of answerPairs) scored.push(pageScore(pair, await replay.retrieve({ query: pair.query, mode })));
    const probes = [];
    for (const pair of probePairs) probes.push(await replay.retrieve({ query: pair.query, mode }));
    const total = scored.length || 1;
    result.modes[mode] = {
      recall10: round(scored.filter((row) => row.hit).length / total),
      mrr10: round(scored.reduce((sum, row) => sum + row.mrr, 0) / total),
      leakedPages: probes.flat().filter((id) => id === 9001 || id === 9002).length,
    };
  }
  return result;
}

module.exports = { measurePages, validatePageFixtures, createPageReplay, pageDocuments, matchPageWhere };
