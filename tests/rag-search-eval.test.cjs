const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { loadFixtures, validate, documents, buildIndex, bm25Field, cosineRank, fuse, decode, vectorsFor, measure, score } = require("../scripts/rag-eval.cjs");
const { createProductionRetriever } = require("../scripts/rag-eval/production.cjs");

const fixtures = loadFixtures();
const vectors = vectorsFor(fixtures);
const rows = documents(fixtures.corpus);
const index = buildIndex(rows);
const make = (options = {}) => createProductionRetriever({ rows, index, vectors, queries: fixtures.queries, bm25Field, cosineRank, fuse, decode, ...options });

test("the test set is valid: board 15 only, 100+ pairs, only the canaries are Deleted", () => {
  assert.deepEqual(validate(fixtures.corpus, fixtures.queries), []);
  assert.ok(fixtures.queries.pairs.length >= 100);
  assert.ok(fixtures.corpus.tasks.every((task) => task.ticketNumber.startsWith("HTPR-")));
  const deleted = rows.filter((row) => row.status === "Deleted");
  assert.equal(deleted.length, 3);
  assert.ok(deleted.every((row) => row.ticketNumber.startsWith("CANARY-")));
});

test("score counts a first-place hit as recall, mrr 1 and the best nDCG", () => {
  const pair = { id: "t", kind: "paraphrase", expected: ["HTPR-1"] };
  assert.deepEqual(score(pair, ["HTPR-1"]), { id: "t", kind: "paraphrase", rank: 1, hit: true, top: ["HTPR-1"], mrr: 1, ndcg: 1 });
  assert.equal(score(pair, ["A", "B", "HTPR-1"]).rank, 3);
  assert.equal(score(pair, ["A"]).hit, false);
});

test("production entry points emit keyword and hybrid plans and suppress deleted canaries", async () => {
  const production = make();
  const pair = fixtures.queries.pairs.find((pair) => pair.kind === "deleted_canary");
  for (const surface of ["rag", "search"]) for (const mode of ["keyword", "semantic", "hybrid"])
    assert.ok(!(await production.retrieve({ pair, surface, mode })).some((ticket) => ticket.startsWith("CANARY-")));
  assert.ok(production.trace.some(({ plan }) => plan.rank_by?.[0] === "Sum"));
  assert.ok(production.trace.some(({ plan }) => plan.queries?.some((query) => query.rank_by[1] === "ANN")));
});

test("deletion mutation in actual RAG source changes measured canary hits", async () => {
  const pair = fixtures.queries.pairs.find((pair) => pair.kind === "deleted_canary");
  const changed = make({ transformSource(file, source) {
    return file.endsWith("retrieveBoardKnowledge.ts") ? source.replaceAll('excludeStatuses: ["Deleted", "Archive"]', "excludeStatuses: []") : source;
  } });
  const request = { pair, mode: "keyword", surface: "rag" };
  assert.equal(score(pair, await make().retrieve(request)).hit, false);
  assert.equal(score(pair, await changed.retrieve(request)).hit, true);
});

test("weight mutation in actual searchTasks source changes ranking, not only copied constants", async () => {
  const pair = { id: "probe", query: "lightning button right click", expected: ["HTPR-9011"] };
  const changed = make({ transformSource(file, source) {
    if (!file.endsWith("turbopufferHelper.ts")) return source;
    return source.replace('[4, ["title"', '[0, ["title"')
      .replace('[2, ["ticketNumber"', '[0, ["ticketNumber"')
      .replace('["searchText", "BM25", query, { last_as_prefix: true }],', '["Product", [0, ["searchText", "BM25", query, { last_as_prefix: true }]]],');
  } });
  const request = { pair, mode: "keyword", surface: "rag" };
  assert.equal(score(pair, await make().retrieve(request)).hit, true);
  assert.equal(score(pair, await changed.retrieve(request)).hit, false);
});

test("the same fixtures always measure the same numbers", async () => {
  const vectors = syntheticVectors(fixtures);
  const result = await measure(fixtures, vectors);
  assert.deepEqual(result, await measure(fixtures, vectors));
  for (const modes of Object.values(result.surfaces)) for (const metrics of Object.values(modes)) {
    for (const value of Object.values(metrics)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
});

function syntheticVectors({ corpus, queries }) {
  const sign = (text) => {
    const hash = createHash("sha256").update(text).digest();
    return Buffer.from(Array.from({ length: 32 }, (_, position) => Math.round((hash[position] / 255 - 0.5) * 200) + 128)).toString("base64");
  };
  return {
    docs: Object.fromEntries([...corpus.tasks, ...corpus.canaries].map((task) => [task.ticketNumber, sign(task.text)])),
    queries: Object.fromEntries(queries.pairs.map((pair) => [pair.id, sign(pair.query)])),
  };
}
