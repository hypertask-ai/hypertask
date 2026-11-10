#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const FIXTURES = join(__dirname, "..", "tests", "fixtures", "rag-search");
const TOP_K = 10;
const FUSION_TOP_K = 50;
const RRF_K = 60;
const K1 = 1.2;
const B = 0.75;
const FIELD_WEIGHTS = { title: 4, ticketNumber: 2, searchText: 1 };
const SURFACES = { rag: null, search: "Normal" };
const MODES = ["keyword", "semantic", "hybrid"];
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_URL = "https://api.openai.com/v1/embeddings";
const EMBED_CAP = 4000;

const readJson = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const round = (value) => Math.round(value * 1000) / 1000;

function loadFixtures() {
  return { corpus: readJson("corpus.json"), queries: readJson("queries.json") };
}

function htmlToText(html) {
  return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, String.fromCharCode(34)).replace(/&#x27;/g, String.fromCharCode(39)).replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").trim();
}

function sanitize(text) {
  return text.replace(/https?:\/\/\S+/g, " ").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
}

function captureBoard(boardId = 15) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = JSON.parse(execFileSync("hypertask", ["task", "list", "--project", String(boardId), "--limit", "100", "--offset", String(offset), "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    rows.push(...(page.tasks ?? []));
    if (!page.tasks?.length || rows.length >= (page.total ?? 0)) break;
  }
  const corpus = readJson("corpus.json");
  corpus.capturedAt = new Date().toISOString().slice(0, 10);
  corpus.tasks = rows.map((task) => ({ id: task.id, ticketNumber: task.ticketNumber, title: String(task.title ?? "").trim(), status: String(task.status ?? "Normal"), text: sanitize(htmlToText(task.description)) })).sort((left, right) => left.ticketNumber.localeCompare(right.ticketNumber, "en", { numeric: true }));
  writeFileSync(join(FIXTURES, "corpus.json"), JSON.stringify(corpus, null, 1) + "\n");
  console.log(`captured ${corpus.tasks.length} tickets from board ${boardId}`);
}

function documents(corpus) {
  return [...corpus.tasks, ...(corpus.canaries ?? [])].map((task) => ({ ...task, text: task.text ?? "", searchText: [task.ticketNumber, task.title, task.text].filter(Boolean).join(" ") }));
}

function validate(corpus, queries) {
  const problems = [];
  const tickets = [...corpus.tasks, ...(corpus.canaries ?? [])];
  const known = new Set(tickets.map((task) => task.ticketNumber));
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

function tokenize(value) {
  return String(value ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function buildIndex(rows) {
  const stats = {};
  for (const field of Object.keys(FIELD_WEIGHTS)) {
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

function bm25Field(index, lengths, field, queryTokens) {
  const { postings, avgLength } = index.stats[field];
  const last = queryTokens[queryTokens.length - 1];
  const scores = new Map();
  for (const token of new Set(queryTokens)) {
    const matched = token === last && token.length >= 2
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

function keywordRank(index, pool, query) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];
  const totals = new Map(pool.map((row) => [row.ticketNumber, 0]));
  for (const field of Object.keys(FIELD_WEIGHTS)) {
    const lengths = new Map(pool.map((row) => [row.ticketNumber, row[`${field}Length`]]));
    for (const [ticketNumber, score] of bm25Field(index, lengths, field, queryTokens)) {
      if (totals.has(ticketNumber)) totals.set(ticketNumber, totals.get(ticketNumber) + score * FIELD_WEIGHTS[field]);
    }
  }
  return [...totals.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([ticketNumber]) => ticketNumber);
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
      for (let index = 0; index < queryVector.length; index += 1) dot += queryVector[index] * vector[index];
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

function retrieve({ documents_: rows, index, vectors, pair, mode, statusFilter }) {
  const pool = statusFilter ? rows.filter((row) => row.status === statusFilter) : rows;
  const keyword = () => keywordRank(index, pool, pair.query);
  const semantic = () => (vectors?.queries?.[pair.id]
    ? cosineRank(pool, (ticketNumber) => (vectors.docs[ticketNumber] ? decode(vectors.docs[ticketNumber]) : null), decode(vectors.queries[pair.id]))
    : []);
  const ranked = mode === "keyword" ? keyword() : mode === "semantic" ? semantic() : fuse([semantic(), keyword()].filter((list) => list.length));
  const exact = /^([A-Za-z]{2,10})[-\s]?(\d{1,7})$/.exec(pair.query.trim());
  const pinned = exact ? `${exact[1].toUpperCase()}-${exact[2]}` : null;
  const ordered = pinned && ranked.includes(pinned) ? [pinned, ...ranked.filter((ticketNumber) => ticketNumber !== pinned)] : ranked;
  return ordered.slice(0, TOP_K);
}

function score(pair, ranked) {
  const position = ranked.findIndex((ticketNumber) => pair.expected.includes(ticketNumber));
  const rank = position < 0 ? null : position + 1;
  return { id: pair.id, kind: pair.kind, rank, hit: rank !== null, top: ranked, mrr: rank ? 1 / rank : 0, ndcg: rank ? 1 / Math.log2(rank + 1) : 0 };
}

function measure({ corpus, queries }, vectors) {
  const problems = validate(corpus, queries);
  if (problems.length) throw new Error(`test set is not valid:\n- ${problems.join("\n- ")}`);
  const rows = documents(corpus);
  const index = buildIndex(rows);
  const statusOf = new Map(rows.map((row) => [row.ticketNumber, row.status]));
  const answerPairs = queries.pairs.filter((pair) => pair.kind !== "deleted_canary");
  const canaryPairs = queries.pairs.filter((pair) => pair.kind === "deleted_canary");
  const result = { ticket: "HTPR-9012", board: corpus.boardId, documents: rows.length, pairs: queries.pairs.length, surfaces: {} };
  for (const [surface, statusFilter] of Object.entries(SURFACES)) {
    result.surfaces[surface] = {};
    for (const mode of MODES) {
      const rank = (pair) => retrieve({ documents_: rows, index, vectors, pair, mode, statusFilter });
      const scored = answerPairs.map((pair) => score(pair, rank(pair)));
      const total = scored.length || 1;
      const canaries = canaryPairs.map((pair) => score(pair, rank(pair)));
      result.surfaces[surface][mode] = {
        recall10: round(scored.filter((row) => row.hit).length / total),
        mrr10: round(scored.reduce((sum, row) => sum + row.mrr, 0) / total),
        ndcg10: round(scored.reduce((sum, row) => sum + row.ndcg, 0) / total),
        deletedRate: round(scored.filter((row) => row.top.some((ticketNumber) => statusOf.get(ticketNumber) === "Deleted")).length / total),
        canaryLeak: round(canaries.filter((row) => row.hit).length / (canaries.length || 1)),
        misses: scored.filter((row) => !row.hit).map((row) => row.id),
      };
    }
  }
  return result;
}

async function embed(inputs) {
  const key = process.env.RAG_EVAL_EMBED_KEY;
  if (!key) return null;
  const vectors = [];
  for (let index = 0; index < inputs.length; index += 64) {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    const body = JSON.stringify({ model: process.env.RAG_EVAL_EMBED_MODEL ?? EMBED_MODEL, input: inputs.slice(index, index + 64) });
    const response = await fetch(process.env.RAG_EVAL_EMBED_URL ?? EMBED_URL, { method: "POST", headers, body });
    if (!response.ok) throw new Error(`embedding ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const payload = await response.json();
    vectors.push(...[...payload.data].sort((left, right) => left.index - right.index).map((row) => row.embedding));
  }
  return vectors;
}

function encode(vector) {
  const norm = Math.hypot(...vector) || 1;
  return Buffer.from(vector.map((value) => Math.max(0, Math.min(255, Math.round((value / norm) * 127) + 128)))).toString("base64");
}

async function vectorsFor({ corpus, queries }) {
  const tickets = [...corpus.tasks, ...(corpus.canaries ?? [])];
  const documentVectors = await embed(tickets.map((task) => [task.ticketNumber, task.title, task.text].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, EMBED_CAP)));
  if (!documentVectors) return null;
  const queryVectors = await embed(queries.pairs.map((pair) => pair.query.slice(0, EMBED_CAP)));
  return {
    model: process.env.RAG_EVAL_EMBED_MODEL ?? EMBED_MODEL,
    docs: Object.fromEntries(tickets.map((ticket, index) => [ticket.ticketNumber, encode(documentVectors[index])])),
    queries: Object.fromEntries(queries.pairs.map((pair, index) => [pair.id, encode(queryVectors[index])])),
  };
}

function printTable(result) {
  const lines = [`AI search test set: ${result.pairs} pairs over ${result.documents} documents (board ${result.board})`, "", "surface  mode      recall@10  mrr@10  nDCG@10  deleted-in-top10  deleted-canary-leak"];
  for (const [surface, modes] of Object.entries(result.surfaces)) for (const mode of MODES) {
    const row = modes[mode];
    lines.push(`${surface.padEnd(8)} ${mode.padEnd(9)} ${String(row.recall10).padEnd(10)} ${String(row.mrr10).padEnd(7)} ${String(row.ndcg10).padEnd(8)} ${String(row.deletedRate).padEnd(17)} ${row.canaryLeak}`);
  }
  return lines.join("\n");
}

function floors(result) {
  const out = {};
  for (const [surface, modes] of Object.entries(result.surfaces)) for (const mode of MODES) {
    for (const key of ["recall10", "mrr10", "ndcg10"]) out[`${surface}.${mode}.${key}`] = modes[mode][key];
  }
  return out;
}

function compareToBaseline(result) {
  let baseline;
  try { baseline = readJson("baseline.json"); } catch { return { ok: true, skipped: "no baseline recorded yet" }; }
  const measured = floors(result);
  const regressions = Object.entries(baseline.floors ?? {})
    .filter(([key, floor]) => typeof measured[key] !== "number" || measured[key] + 0.001 < floor)
    .map(([key, floor]) => `${key} fell from ${floor} to ${measured[key]}`);
  return { ok: regressions.length === 0, recordedAt: baseline.recordedAt, regressions };
}

async function main(argv) {
  const fixtures = loadFixtures();
  if (argv.includes("--capture")) return captureBoard(), 0;
  if (argv.includes("--check-set")) {
    const problems = validate(fixtures.corpus, fixtures.queries);
    if (problems.length) {
      console.error(problems.join("\n"));
      return 1;
    }
    console.log(`check-set ok: ${fixtures.queries.pairs.length} pairs, ${fixtures.corpus.tasks.length} tickets, ${fixtures.corpus.canaries.length} deleted canaries`);
    return 0;
  }
  const vectors = await vectorsFor(fixtures);
  if (!vectors) {
    console.error("set RAG_EVAL_EMBED_KEY to embed the fixtures before scoring");
    return 1;
  }
  const result = measure(fixtures, vectors);
  if (argv.includes("--write-baseline")) {
    writeFileSync(join(FIXTURES, "baseline.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), model: vectors.model, floors: floors(result), result }, null, 1)}\n`);
    console.log(printTable(result));
    console.log("\nbaseline written to tests/fixtures/rag-search/baseline.json");
    return 0;
  }
  console.log(argv.includes("--json") ? JSON.stringify(result, null, 1) : printTable(result));
  if (argv.includes("--check-baseline")) {
    const check = compareToBaseline(result);
    if (!check.ok) {
      console.error(`\nbaseline regression against ${check.recordedAt}:\n- ${check.regressions.join("\n- ")}`);
      return 1;
    }
    console.error(`\nbaseline ok${check.skipped ? ` (${check.skipped})` : ` against ${check.recordedAt}`}`);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { validate, measure, documents, retrieve, buildIndex, keywordRank, cosineRank, fuse, score, tokenize, loadFixtures, printTable, floors };
