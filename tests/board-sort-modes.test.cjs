const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSortComparator,
  comparatorForSortingMode,
} = require("./board-sort-modes-entry.cjs");

test("TimeOnBoard Descending puts the oldest-created task first", () => {
  const oldest = { id: "oldest", createdAt: "2026-01-01T00:00:00.000Z" };
  const newest = { id: "newest", createdAt: "2026-07-01T00:00:00.000Z" };
  const comparator = comparatorForSortingMode("TimeOnBoard", "Descending");

  assert.deepEqual([newest, oldest].sort(comparator).map(({ id }) => id), [
    "oldest",
    "newest",
  ]);
});

test("TimeInColumn Descending matches SectionChangedAt Ascending", () => {
  const tasks = [
    { id: "newest", sectionChangedAt: "2026-07-01T00:00:00.000Z" },
    { id: "oldest", sectionChangedAt: "2026-01-01T00:00:00.000Z" },
    { id: "middle", sectionChangedAt: "2026-04-01T00:00:00.000Z" },
  ];
  const durationComparator = comparatorForSortingMode("TimeInColumn", "Descending");
  const timestampComparator = comparatorForSortingMode("SectionChangedAt", "Ascending");

  assert.deepEqual(
    tasks.slice().sort(durationComparator).map(({ id }) => id),
    tasks.slice().sort(timestampComparator).map(({ id }) => id)
  );
});

test("Assignee sorts alphabetically while unassigned tasks stay last", () => {
  const alex = {
    id: "alex",
    assignees: [{ user: { displayName: "Alex" } }],
  };
  const zoe = {
    id: "zoe",
    assignees: [{ agent: { displayName: "Zoe" } }],
  };
  const unassigned = { id: "unassigned", assignees: [] };
  const ascending = comparatorForSortingMode("Assignee", "Ascending");
  const descending = comparatorForSortingMode("Assignee", "Descending");

  assert.deepEqual(
    [unassigned, zoe, alex].sort(ascending).map(({ id }) => id),
    ["alex", "zoe", "unassigned"]
  );
  assert.deepEqual(
    [unassigned, alex, zoe].sort(descending).map(({ id }) => id),
    ["zoe", "alex", "unassigned"]
  );
});

test("Assignee keys on the agent, not the owner behind it", () => {
  // An agent assignment also carries its owner in `user`, and the card renders the agent. Keying
  // on the user would sort "Alpha Agent" by its owner "Zoe" and bury it below a human "Beta".
  const alphaAgent = {
    id: "alphaAgent",
    assignees: [{ agent: { displayName: "Alpha" }, user: { displayName: "Zoe" } }],
  };
  const betaHuman = { id: "betaHuman", assignees: [{ user: { displayName: "Beta" } }] };
  const comparator = comparatorForSortingMode("Assignee", "Ascending");

  assert.deepEqual([betaHuman, alphaAgent].sort(comparator).map(({ id }) => id), [
    "alphaAgent",
    "betaHuman",
  ]);
});

test("TicketNumber sorts unique indexes numerically", () => {
  const tasks = [
    { id: "two", uniqueIndex: 2 },
    { id: "three", uniqueIndex: 3 },
    { id: "one", uniqueIndex: 1 },
  ];
  const ascending = comparatorForSortingMode("TicketNumber", "Ascending");
  const descending = comparatorForSortingMode("TicketNumber", "Descending");

  assert.deepEqual(tasks.slice().sort(ascending).map(({ uniqueIndex }) => uniqueIndex), [1, 2, 3]);
  assert.deepEqual(tasks.slice().sort(descending).map(({ uniqueIndex }) => uniqueIndex), [3, 2, 1]);
});

test("Title Ascending breaks a Priority tie regardless of ranking", () => {
  const alpha = {
    id: "alpha",
    title: "Alpha",
    ranking: "zzz",
    priority: { priority_index: 1 },
  };
  const beta = {
    id: "beta",
    title: "Beta",
    ranking: "aaa",
    priority: { priority_index: 1 },
  };
  const comparator = buildSortComparator([
    { mode: "Priority", order: "Descending" },
    { mode: "Title", order: "Ascending" },
  ]);

  assert.deepEqual([beta, alpha].sort(comparator).map(({ id }) => id), [
    "alpha",
    "beta",
  ]);
});
