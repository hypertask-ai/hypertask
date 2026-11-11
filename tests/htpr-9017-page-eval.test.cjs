const test = require("node:test");
const assert = require("node:assert/strict");

const { measurePages, validatePageFixtures, createPageReplay } = require("../scripts/rag-eval/pages.cjs");
const { tokenize, loadPageFixtures } = require("../scripts/rag-eval.cjs");

const fixtures = loadPageFixtures();

test("page fixtures are a valid board-15 set with real pages and access probes", () => {
  assert.deepEqual(validatePageFixtures(fixtures.corpus, fixtures.queries), []);
  const pairs = fixtures.queries.pairs.filter((pair) => pair.kind === "paraphrase");
  assert.ok(pairs.length >= 15, `only ${pairs.length} page pairs`);
  assert.ok(fixtures.corpus.pages.some((page) => page.projectId !== 15), "no page outside the board");
});

test("index page search finds pages that today's literal search misses", async () => {
  const result = await measurePages(fixtures, { tokenize });
  assert.ok(result.modes.index.recall10 >= 0.8, `index recall@10 ${result.modes.index.recall10}`);
  assert.ok(result.modes.index.mrr10 > result.modes.literal.mrr10, `index mrr ${result.modes.index.mrr10} vs literal ${result.modes.literal.mrr10}`);
  assert.ok(result.modes.literal.recall10 < result.modes.index.recall10, "literal search did not lose to the index");
});

test("pages on another board never come back from either search", async () => {
  const result = await measurePages(fixtures, { tokenize });
  assert.equal(result.modes.index.leakedPages, 0);
  assert.equal(result.modes.literal.leakedPages, 0);
});

test("the index is only read when the page search flag is on", async () => {
  const replay = createPageReplay({ corpus: fixtures.corpus, tokenize });
  const pair = fixtures.queries.pairs.find((row) => row.kind === "paraphrase");
  await replay.retrieve({ query: pair.query, mode: "literal" });
  assert.equal(replay.trace.length, 0);
  const found = await replay.retrieve({ query: pair.query, mode: "index" });
  assert.ok(replay.trace.length > 0);
  assert.equal(replay.trace[0].plan.rank_by[0], "Product");
  assert.deepEqual(
    replay.trace[0].plan.rank_by[1][1][1],
    ["title", "BM25", pair.query, { last_as_prefix: true }]
  );
  assert.ok(found.length <= 50);
});
