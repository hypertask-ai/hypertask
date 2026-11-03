const test = require("node:test");
const assert = require("node:assert/strict");

const { loadRoute, commentFixture } = require("./helpers/comment-list-route.cjs");

// HTPR-8377: an activity read is a page, not the whole ticket. Prisma returns
// the rows the query asks for, so asking oldest-first meant a limited read
// handed back the oldest rows and never the entry just posted.
const newestFirst = [
  commentFixture({ id: 14, text: "moved to QA", activity: { type: "TaskMoved" }, createdAt: new Date("2026-11-03T12:00:00.000Z") }),
  commentFixture({ id: 13, text: "assigned", activity: { type: "TaskAssigned" }, createdAt: new Date("2026-11-03T11:00:00.000Z") }),
  commentFixture({ id: 2, text: "old note", createdAt: new Date("2026-10-01T09:00:00.000Z") }),
  commentFixture({ id: 1, text: "oldest note", createdAt: new Date("2026-10-01T08:00:00.000Z") }),
];

test("a limited activity read asks for the newest rows so what was just posted comes back", async () => {
  const route = loadRoute(newestFirst);
  const response = await route.get({ task_id: "100", include_activity: "true", limit: "2" });

  assert.equal(response.status, 200);
  assert.deepEqual(route.getQuery().orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(route.getQuery().take, 2);
  assert.equal(response.body.comments[0].id, 14);
});

test("an activity read defaults to the same order as a plain comment read", async () => {
  const withActivity = loadRoute(newestFirst);
  await withActivity.get({ task_id: "100", include_activity: "true" });
  const plain = loadRoute(newestFirst);
  await plain.get({ task_id: "100" });
  assert.deepEqual(withActivity.getQuery().orderBy, plain.getQuery().orderBy);
});

test("an explicit sort order still wins on an activity read", async () => {
  const named = loadRoute(newestFirst);
  await named.get({ task_id: "100", include_activity: "true", sort_order: "asc" });
  assert.deepEqual(named.getQuery().orderBy, [{ createdAt: "asc" }, { id: "asc" }]);

  const collection = loadRoute(newestFirst);
  await collection.get({ task_id: "100", include_activity: "true", sort: "createdAt:asc" });
  assert.deepEqual(collection.getQuery().orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
});
