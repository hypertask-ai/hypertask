const test = require("node:test");
const assert = require("node:assert/strict");

const { loadRoute, commentFixture } = require("./helpers/comment-list-route.cjs");

const comments = [
  commentFixture({ id: 7, text: "First", commentText: "First", createdAt: new Date("2026-09-07T00:00:00.000Z") }),
  commentFixture({ id: 8, text: "Second", commentText: "Second", createdAt: new Date("2026-09-07T00:01:00.000Z") }),
];

test("a field the comment row does not have is refused with the valid names", async () => {
  const route = loadRoute(comments);
  const response = await route.get({ task_id: "100", fields: "createdAt,author" });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Validation error");
  assert.match(response.body.message, /not known: author/);
  assert.match(response.body.message, /kind/);
  assert.match(response.body.message, /commentText/);
  assert.match(response.body.message, /agent_display_name/);
  assert.equal(route.getQuery(), undefined, "a refused projection must not read the comments");
});

test("every valid field still projects the row", async () => {
  const route = loadRoute(comments);
  const response = await route.get({ task_id: "100", fields: "createdAt,commentText" });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body.comments[0]), ["createdAt", "commentText"]);
  assert.equal(response.body.comments[0].commentText, "First");
  assert.equal(response.body.total, 2);
});

test("an unknown sort value and an unknown field are both refused", async () => {
  const route = loadRoute(comments);
  assert.equal((await route.get({ task_id: "100", sort: "bogus" })).status, 400);
  assert.equal((await route.get({ task_id: "100", fields: "author" })).status, 400);
});

test("activity fields ask for include_activity instead of silently vanishing", async () => {
  const route = loadRoute([commentFixture({ id: 9, type: "comment" })]);
  const withoutActivity = await route.get({ task_id: "100", fields: "type" });
  assert.equal(withoutActivity.status, 400);
  assert.match(withoutActivity.body.message, /include_activity/);
  const withActivity = await route.get({ task_id: "100", fields: "type", include_activity: "true" });
  assert.equal(withActivity.status, 200);
  assert.deepEqual(Object.keys(withActivity.body.comments[0]), ["type"]);
});
