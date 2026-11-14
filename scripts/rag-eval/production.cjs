const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const ts = require("typescript");

function matches(row, filter) {
  if (!filter) return true;
  const [field, operator, value] = filter;
  if (field === "And") return operator.every((part) => matches(row, part));
  if (operator === "Eq") return row[field] === value;
  if (operator === "NotEq") return row[field] !== value;
  if (operator === "In") return value.includes(row[field]);
  throw new Error(`Unsupported fixture filter: ${JSON.stringify(filter)}`);
}

function createProductionRetriever({ rows, index, vectors, bm25Field, cosineRank, fuse, decode, transformSource = (_file, source) => source }) {
  let active;
  const trace = [];
  const failures = [];
  const cache = new Map();
  const byTicket = new Map(rows.map((row) => [row.ticketNumber, row]));
  const stubs = {
    "@prisma/client": {},
    "@/lib/prisma": { project: { findMany: async () => [{ id: 15 }] } },
    "@/lib/auth/agentScope": { recordAgentBoardScopeMiss: () => {} },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/lib/ai/spend/embeddingRoute": { embeddingSpendMode: async () => ({ mode: active.mode === "keyword" ? "keyword" : "current" }) },
    "@/lib/turbopuffer": {
      __esModule: true,
      default: { namespace: (name) => ({ query: async (plan) => {
        try { return execute(name, plan); }
        catch (error) { failures.push(error); throw error; }
      } }) },
      turbopufferNamespaces: { task: { name: "tasks" }, comment: { name: "comments" } },
    },
  };
  function fieldScores(pool, spec) {
    if (spec[0] === "Sum") {
      const totals = new Map();
      for (const child of spec[1]) for (const [ticket, value] of fieldScores(pool, child)) totals.set(ticket, (totals.get(ticket) ?? 0) + value);
      return totals;
    }
    if (spec[0] === "Product") {
      const [weight, child] = spec[1];
      return new Map([...fieldScores(pool, child)].map(([ticket, value]) => [ticket, value * weight]));
    }
    const [field, operator, text, options] = spec;
    if (operator !== "BM25") throw new Error(`Unsupported fixture ranking: ${JSON.stringify(spec)}`);
    const lengths = new Map(pool.map((row) => [row.ticketNumber, row[`${field}Length`]]));
    return bm25Field(index, lengths, field, load("src/utils/controllers/search/rankHits.ts").tokenize(text), options?.last_as_prefix);
  }
  function ranked(plan) {
    const pool = rows.filter((row) => matches(row, plan.filters));
    if (!plan.rank_by) return pool.slice(0, plan.top_k).map((row) => row.ticketNumber);
    if (plan.rank_by[1] === "ANN") return cosineRank(pool, (ticket) => decode(vectors.docs[ticket]), plan.rank_by[2]).slice(0, plan.top_k);
    const scores = fieldScores(pool, plan.rank_by);
    return pool.filter((row) => (scores.get(row.ticketNumber) ?? 0) > 0)
      .sort((a, b) => scores.get(b.ticketNumber) - scores.get(a.ticketNumber) || a.ticketNumber.localeCompare(b.ticketNumber))
      .slice(0, plan.top_k).map((row) => row.ticketNumber);
  }
  function execute(namespace, plan) {
    trace.push({ namespace, plan });
    if (namespace === "comments") return plan.queries ? { results: [{ rows: [] }] } : { rows: [] };
    const materialize = (tickets) => tickets.map((ticket) => byTicket.get(ticket));
    if (!plan.queries) return { rows: materialize(ranked(plan)) };
    if (plan.rerank_by?.[0] !== "RRF") throw new Error("Unsupported fixture fusion");
    const branches = active.mode === "semantic" ? plan.queries.filter((query) => query.rank_by[1] === "ANN") : plan.queries;
    return { results: [{ rows: materialize(branches.length === 1 ? ranked(branches[0]) : fuse(branches.map(ranked))) }] };
  }
  const fixtureFetch = async (_url, options) => {
    const { input } = JSON.parse(options.body);
    const data = input.map((_text, position) => {
      const embedding = [...decode(vectors.queries[active.pair.id])];
      while (embedding.length < 1536) embedding.push(0);
      return { index: position, embedding };
    });
    return { ok: true, json: async () => ({ data }) };
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const filename = join(__dirname, "../..", file);
    const source = transformSource(file, readFileSync(filename, "utf8"));
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const localRequire = (request) => {
      if (Object.hasOwn(stubs, request)) return stubs[request];
      if (request === "@/utils/controllers/turbopuffer/turbopufferHelper") return load("src/utils/controllers/turbopuffer/turbopufferHelper.ts");
      if (request === "@/utils/controllers/search/rankHits") return load("src/utils/controllers/search/rankHits.ts");
      if (request === "./authorizeIndexedRows") return load("src/lib/rag/authorizeIndexedRows.ts");
      if (request === "@/lib/flags/definitions/htpr-9013-rag-comments") return load("src/lib/flags/definitions/htpr-9013-rag-comments.ts");
      if (request === "@/app/api/ai/_lib/boardMemoryContract") return { buildCustomInstructionSearchFilters: () => { throw new Error("Unexpected custom instruction search"); } };
      if (["crypto", "node-html-parser"].includes(request)) return require(request);
      const error = new Error(`Unexpected production dependency: ${request} (${file})`);
      failures.push(error); throw error;
    };
    new Function("require", "module", "exports", "fetch", "process", code)(localRequire, loaded, loaded.exports, fixtureFetch, { env: { TURBOPUFFER_EMBEDDINGS_API_KEY: "offline-fixture" } });
    return loaded.exports;
  }
  return {
    trace,
    async retrieve({ pair, mode, surface }) {
      active = { pair, mode };
      failures.length = 0;
      if (surface === "rag") {
        const response = await load("src/lib/rag/retrieveBoardKnowledge.ts").retrieveBoardKnowledge({ query: pair.query, projectId: 15, limit: 10 }, { userId: 985 });
        if (failures.length) throw failures[0];
        if (!response.success) throw new Error(response.error);
        return response.documents.map((document) => document.ticketNumber);
      }
      if (surface !== "search") throw new Error(`Unknown surface ${surface}`);
      const result = await load("src/utils/controllers/turbopuffer/turbopufferHelper.ts").searchTasks({ searchQuery: pair.query, projectIds: [15], status: "Normal", topK: 10 });
      if (failures.length) throw failures[0];
      return result.map((row) => row.ticketNumber);
    },
  };
}
module.exports = { createProductionRetriever, matches };
