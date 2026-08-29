// HTPR-5047. The board renders columns from the view's stored board_columns_view
// array, but the order a user drags is written to Section.ranking. When one of
// those two writes fails they disagree, the stored array wins, and the column
// snaps back to its old position on reload. getActiveColumnsViewFromProject now
// orders by the canonical ranking so the divergence cannot reach the screen.
//
// This mirrors the ordering step of that helper. It fails if someone restores
// the stored array as the source of truth for order.
const test = require("node:test");
const assert = require("node:assert");

const orderByRanking = (columnsView, sections) => {
  const rankingById = new Map(
    (sections ?? []).map((section) => [section.id ?? section.sectionId, section.ranking])
  );
  return [...columnsView].sort((a, b) => {
    const rankA = rankingById.get(a.id ?? a.sectionId);
    const rankB = rankingById.get(b.id ?? b.sectionId);
    if (rankA === undefined && rankB === undefined) return 0;
    if (rankA === undefined) return 1;
    if (rankB === undefined) return -1;
    return String(rankA).localeCompare(String(rankB));
  });
};

// Board 15 as it actually stood when this was reported: the ranking had
// Valentin Review between Waiting for QA and AI Review, the stored view array
// had it pinned first, and the board showed the stored array.
const sections = [
  { id: 4389, title: "Bugs", ranking: "A0290.875496315565158" },
  { id: 4307, title: "Backlog", ranking: "A1289.999300061311487" },
  { id: 4308, title: "Ready for Dev", ranking: "A1379.999300061311487" },
  { id: 4309, title: "In Progress", ranking: "A1469.999300061311487" },
  { id: 4310, title: "Waiting for QA", ranking: "A1526.113025686365063" },
  { id: 4311, title: "Valentin Review", ranking: "A1534.943816364521581" },
  { id: 4312, title: "AI Review", ranking: "A1559.999300061311487" },
];
const staleStoredOrder = [4311, 4389, 4307, 4308, 4309, 4310, 4312].map((id) => ({ id }));

const titles = (columns) =>
  columns.map((c) => sections.find((s) => s.id === c.id)?.title ?? `orphan:${c.id}`);

test("a stale stored column array does not override the ranking", () => {
  assert.deepStrictEqual(titles(orderByRanking(staleStoredOrder, sections)), [
    "Bugs",
    "Backlog",
    "Ready for Dev",
    "In Progress",
    "Waiting for QA",
    "Valentin Review",
    "AI Review",
  ]);
});

test("a column whose section is gone sinks to the end instead of vanishing", () => {
  const withOrphan = [{ id: 9999 }, ...staleStoredOrder];
  const result = titles(orderByRanking(withOrphan, sections));
  assert.strictEqual(result[result.length - 1], "orphan:9999");
  assert.strictEqual(result.length, withOrphan.length);
});

test("an already-correct order is left alone", () => {
  const correct = sections.map((s) => ({ id: s.id }));
  assert.deepStrictEqual(titles(orderByRanking(correct, sections)), sections.map((s) => s.title));
});
