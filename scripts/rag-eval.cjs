#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const jiti = require("jiti")(__filename, { alias: { "@": join(__dirname, "..", "src") }, fsCache: false, interopDefault: true });
const { tokenize } = jiti(join(__dirname, "..", "src", "utils", "controllers", "search", "rankHits.ts"));

const FIXTURES = join(__dirname, "..", "tests", "fixtures", "rag-search");
const FUSION_TOP_K = 50;
const RRF_K = 60;
const K1 = 1.2;
const B = 0.75;
const INDEX_FIELDS = ["title", "ticketNumber", "searchText"];
const SURFACES = ["rag", "search"];
const { createProductionRetriever } = require("./rag-eval/production.cjs");
const { measurePages, validatePageFixtures } = require("./rag-eval/pages.cjs");
const MODES = ["keyword", "semantic", "hybrid"];
const readJson = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const round = (value) => Math.round(value * 1000) / 1000;

function fixtureHash() {
  const hash = createHash("sha256");
  for (const name of ["corpus.json", "queries.json"]) hash.update(readFileSync(join(FIXTURES, name)));
  return hash.digest("hex").slice(0, 16);
}

function loadFixtures() {
  return { corpus: readJson("corpus.json"), queries: readJson("queries.json") };
}

function loadPageFixtures() {
  return { corpus: readJson("pages.json"), queries: readJson("page-queries.json") };
}

function documents(corpus) {
  return [...corpus.tasks, ...(corpus.canaries ?? [])].map((task) => ({
    ...task,
    id: String(task.id ?? task.ticketNumber),
    projectId: 15,
    uniqueIndex: Number(task.ticketNumber.split("-").at(-1)),
    descriptionText: task.text ?? "",
    text: task.text ?? "",
    searchText: [task.ticketNumber, task.title, task.text].filter(Boolean).join(" "),
  }));
}

function validate(corpus, queries) {
  const problems = [];
  const known = new Set([...corpus.tasks, ...(corpus.canaries ?? [])].map((task) => task.ticketNumber));
  const pairs = queries.pairs ?? [];
  const canaries = corpus.canaries ?? [];
  if (corpus.boardId !== 15 || queries.boardId !== 15) problems.push("fixtures must come from board 15");
  if (pairs.length < 100) problems.push(`only ${pairs.length} pairs, need at least 100`);
  if (!corpus.tasks.every((task) => task.status === "Normal")) problems.push("corpus tasks must all be Normal");
  if (!canaries.length) problems.push("no deleted canaries, the deleted leak rate cannot be measured");
  if (!canaries.every((task) => task.status === "Deleted" && task.canary === true)) problems.push("canaries must be Deleted and marked canary: true");
  if (!pairs.some((pair) => pair.kind === "deleted_canary")) problems.push("no deleted canary probes");
  const ids = new Set();
  const answered = new Set();
  for (const pair of pairs) {
    if (!pair.id || ids.has(pair.id)) problems.push(`pair id missing or repeated: ${pair.id}`);
    ids.add(pair.id);
    if (!pair.query || pair.query.trim().length < 8) problems.push(`${pair.id} has no usable query`);
    if (!pair.expected?.length) problems.push(`${pair.id} has no expected ticket`);
    for (const ticket of pair.expected ?? []) {
      if (!known.has(ticket)) problems.push(`${pair.id} expects ${ticket}, which is not in the corpus`);
      if (pair.kind !== "deleted_canary") answered.add(ticket);
    }
  }
  if (answered.size < 80) problems.push(`only ${answered.size} distinct answers, need at least 80`);
  return problems;
}

function buildIndex(rows) {
  const stats = {};
  for (const field of INDEX_FIELDS) {
    const postings = new Map();
    let total = 0;
    for (const row of rows) {
      const tokens = tokenize(row[field]);
      row[`${field}Length`] = tokens.length;
      total += tokens.length;
      for (const token of tokens) {
        if (!postings.has(token)) postings.set(token, new Map());
        postings.get(token).set(row.ticketNumber, (postings.get(token).get(row.ticketNumber) ?? 0) + 1);
      }
    }
    stats[field] = { postings, avgLength: total / (rows.length || 1) };
  }
  return { stats, size: rows.length };
}

function bm25Field(index, lengths, field, queryTokens, lastAsPrefix = true) {
  const { postings, avgLength } = index.stats[field];
  const last = queryTokens[queryTokens.length - 1];
  const scores = new Map();
  for (const token of new Set(queryTokens)) {
    const matched = lastAsPrefix && token === last && token.length >= 2
      ? [...postings.keys()].filter((candidate) => candidate.startsWith(token))
      : postings.has(token) ? [token] : [];
    if (!matched.length) continue;
    const holders = new Set(matched.flatMap((candidate) => [...postings.get(candidate).keys()]));
    const idf = Math.log(1 + (index.size - holders.size + 0.5) / (holders.size + 0.5));
    for (const candidate of matched) {
      for (const [ticketNumber, frequency] of postings.get(candidate)) {
        const length = lengths.get(ticketNumber) ?? 0;
        const weight = (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / (avgLength || 1)));
        scores.set(ticketNumber, (scores.get(ticketNumber) ?? 0) + idf * weight);
      }
    }
  }
  return scores;
}

function decode(base64) {
  return Float64Array.from(Buffer.from(base64, "base64"), (byte) => (byte - 128) / 127);
}

function cosineRank(pool, vectorOf, queryVector) {
  const queryNorm = Math.hypot(...queryVector) || 1;
  return pool
    .map((row) => {
      const vector = vectorOf(row.ticketNumber);
      if (!vector) return [row.ticketNumber, 0];
      let dot = 0;
      for (let index = 0; index < Math.min(queryVector.length, vector.length); index += 1) dot += queryVector[index] * vector[index];
      return [row.ticketNumber, dot / (queryNorm * (Math.hypot(...vector) || 1))];
    })
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([ticketNumber]) => ticketNumber);
}

function fuse(lists) {
  const totals = new Map();
  for (const list of lists) list.slice(0, FUSION_TOP_K).forEach((ticketNumber, index) => {
    totals.set(ticketNumber, (totals.get(ticketNumber) ?? 0) + 1 / (RRF_K + index + 1));
  });
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([ticketNumber]) => ticketNumber);
}

function score(pair, ranked) {
  const position = ranked.findIndex((ticketNumber) => pair.expected.includes(ticketNumber));
  const rank = position < 0 ? null : position + 1;
  return { id: pair.id, kind: pair.kind, rank, hit: rank !== null, top: ranked, mrr: rank ? 1 / rank : 0, ndcg: rank ? 1 / Math.log2(rank + 1) : 0 };
}

async function measure({ corpus, queries }, vectors, options = {}) {
  const problems = validate(corpus, queries);
  if (problems.length) throw new Error(`test set is not valid:\n- ${problems.join("\n- ")}`);
  const rows = documents(corpus);
  const index = buildIndex(rows);
  const production = createProductionRetriever({ rows, index, vectors, queries, bm25Field, cosineRank, fuse, decode, ...options });
  const statusOf = new Map(rows.map((row) => [row.ticketNumber, row.status]));
  const answerPairs = queries.pairs.filter((pair) => pair.kind !== "deleted_canary");
  const canaryPairs = queries.pairs.filter((pair) => pair.kind === "deleted_canary");
  const result = { ticket: "HTPR-9012", board: corpus.boardId, documents: rows.length, pairs: queries.pairs.length, fixtures: fixtureHash(), model: vectors.model, backend: "offline production-entry-point replay", surfaces: {} };
  for (const surface of SURFACES) {
    result.surfaces[surface] = {};
    for (const mode of MODES) {
      const rank = async (pair) => score(pair, await production.retrieve({ pair, mode, surface }));
      const scored = [];
      for (const pair of answerPairs) scored.push(await rank(pair));
      const total = scored.length || 1;
      const canaries = [];
      for (const pair of canaryPairs) canaries.push(await rank(pair));
      result.surfaces[surface][mode] = {
        recall10: round(scored.filter((row) => row.hit).length / total),
        mrr10: round(scored.reduce((sum, row) => sum + row.mrr, 0) / total),
        ndcg10: round(scored.reduce((sum, row) => sum + row.ndcg, 0) / total),
        deletedRate: round(scored.filter((row) => row.top.some((ticketNumber) => statusOf.get(ticketNumber) === "Deleted")).length / total),
        canaryLeak: round(canaries.filter((row) => row.hit).length / (canaries.length || 1)),
      };
    }
  }
  return result;
}

function vectorsFor({ corpus, queries }) {
  const vectors = readJson("vectors.json");
  if (vectors.fixtures !== fixtureHash()) throw new Error("saved vectors are stale for these fixtures");
  for (const task of [...corpus.tasks, ...corpus.canaries]) if (!vectors.docs?.[task.ticketNumber]) throw new Error(`missing vector: ${task.ticketNumber}`);
  for (const pair of queries.pairs) if (!vectors.queries?.[pair.id]) throw new Error(`missing query vector: ${pair.id}`);
  return vectors;
}

function printTable(result, pages) {
  const lines = [`AI search test set: ${result.pairs} pairs over ${result.documents} documents (board ${result.board})`, "", "surface  mode      recall@10  mrr@10  nDCG@10  deleted-in-top10  deleted-canary-leak"];
  for (const [surface, modes] of Object.entries(result.surfaces)) for (const mode of MODES) lines.push(`${surface.padEnd(8)} ${mode.padEnd(9)} ${String(modes[mode].recall10).padEnd(10)} ${String(modes[mode].mrr10).padEnd(7)} ${String(modes[mode].ndcg10).padEnd(8)} ${String(modes[mode].deletedRate).padEnd(17)} ${modes[mode].canaryLeak}`);
  if (pages) {
    lines.push("", `Page search test set: ${pages.pairs} pairs over ${pages.pages} pages, plus ${pages.probes} access probes (board ${pages.board})`, "", "surface  mode      recall@10  mrr@10  pages-outside-board-returned");
    for (const mode of ["literal", "index"]) lines.push(`${"pages".padEnd(8)} ${mode.padEnd(9)} ${String(pages.modes[mode].recall10).padEnd(10)} ${String(pages.modes[mode].mrr10).padEnd(7)} ${pages.modes[mode].leakedPages}`);
  }
  return lines.join("\n");
}

async function main(argv) {
  const fixtures = loadFixtures();
  const pageFixtures = loadPageFixtures();
  if (argv.includes("--check-set")) {
    const problems = [...validate(fixtures.corpus, fixtures.queries), ...validatePageFixtures(pageFixtures.corpus, pageFixtures.queries)];
    if (problems.length) {
      console.error(problems.join("\n"));
      return 1;
    }
    console.log(`check-set ok: ${fixtures.queries.pairs.length} pairs, ${fixtures.corpus.tasks.length} tickets, ${fixtures.corpus.canaries.length} deleted canaries, ${pageFixtures.queries.pairs.length} page pairs, ${pageFixtures.corpus.pages.length} pages`);
    return 0;
  }
  const vectors = vectorsFor(fixtures);
  const result = await measure(fixtures, vectors);
  const pages = await measurePages(pageFixtures, { tokenize });
  console.log(printTable(result, pages));
  console.log(`\nReport only; offline ${vectors.model} vectors for tickets, production page-service replay for pages, not a live Turbopuffer benchmark.`);
  const output = argv.indexOf("--output");
  if (output !== -1) writeFileSync(argv[output + 1], `${JSON.stringify({ ...result, pageSearch: pages }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { validate, measure, documents, buildIndex, bm25Field, cosineRank, fuse, score, tokenize, loadFixtures, loadPageFixtures, printTable, fixtureHash, vectorsFor, decode };
