const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const { loadFixtures, validate, buildIndex, fuse, documents, retrieve, measure, score, floors } = require("../scripts/rag-eval.cjs");

const fixtures = loadFixtures();
const rows = documents(fixtures.corpus);
const index = buildIndex(rows);
const keyword = (query, statusFilter = null) => retrieve({ documents_: rows, index, vectors: null, pair: { id: "t", query }, mode: "keyword", statusFilter });

test("the test set is valid: board 15 only, 100+ pairs, deleted canaries the only Deleted rows", () => {
  assert.deepEqual(validate(fixtures.corpus, fixtures.queries), []);
  assert.ok(fixtures.queries.pairs.length >= 100);
  assert.ok(fixtures.corpus.tasks.length >= 150);
  assert.ok(fixtures.corpus.tasks.every((task) => task.ticketNumber.startsWith("HTPR-")));
  const deleted = rows.filter((row) => row.status === "Deleted");
  assert.equal(deleted.length, 3);
  assert.ok(deleted.every((row) => row.ticketNumber.startsWith("CANARY-")));
});

test("word search finds a ticket by its number and by a title phrase", () => {
  assert.equal(keyword("HTPR-9014")[0], "HTPR-9014");
  assert.ok(keyword("lightning button right click").slice(0, 5).includes("HTPR-9011"));
});

test("fusion ranks a ticket found by both retrievers above one found by one", () => {
  const ranked = fuse([["A", "B", "C"], ["C", "D"]]);
  assert.equal(ranked[0], "C");
  assert.ok(ranked.indexOf("A") > 0);
});

test("a deleted row is hidden only when the surface filters to Normal", () => {
  assert.ok(keyword("office kitchen rota rotation").includes("CANARY-1"));
  assert.ok(!keyword("office kitchen rota rotation", "Normal").includes("CANARY-1"));
});

test("score counts a first-place hit as recall, mrr 1 and the best nDCG", () => {
  const pair = { id: "t", kind: "paraphrase", expected: ["HTPR-1"] };
  assert.deepEqual(score(pair, ["HTPR-1"]), { id: "t", kind: "paraphrase", rank: 1, hit: true, top: ["HTPR-1"], mrr: 1, ndcg: 1 });
  assert.equal(score(pair, ["A", "B", "HTPR-1"]).rank, 3);
  assert.equal(score(pair, ["A"]).hit, false);
});

test("the same fixtures always measure the same numbers", () => {
  const vectors = syntheticVectors(fixtures);
  const result = measure(fixtures, vectors);
  assert.deepEqual(result, measure(fixtures, vectors));
  assert.equal(Object.keys(floors(result)).length, 18);
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
