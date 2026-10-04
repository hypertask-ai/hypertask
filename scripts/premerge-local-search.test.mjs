import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { fixtureSearchServer, queryFixtureRows } from "./premerge-local-search.mjs";

const rows = [
  { id: "1", projectId: 1, status: "Normal", searchText: "Board fixture" },
  { id: "2", projectId: 2, status: "Normal", searchText: "Demo fixture" },
  { id: "3", projectId: 1, status: "Archive", searchText: "Archived fixture" },
];
const rank_by = ["Sum", [["title", "BM25", "fixture"], ["searchText", "BM25", "fixture"]]];

test("fixture search honors project/status filters, query text and limits", () => {
  const query = { rank_by, filters: ["And", [["projectId", "In", [1, 2]], ["status", "Eq", "Normal"]]] };
  assert.deepEqual(queryFixtureRows(rows, query).map(row => row.id), ["1", "2"]);
  assert.deepEqual(queryFixtureRows(rows, { ...query, top_k: 1 }).map(row => row.id), ["1"]);
  assert.deepEqual(queryFixtureRows(rows, { rank_by: ["title", "BM25", "missing"] }), []);
  assert.deepEqual(queryFixtureRows(rows, { rank_by, filters: ["projectId", "Eq", 2] }).map(row => row.id), ["2"]);
  assert.throws(() => queryFixtureRows(rows, { filters: ["projectId", "Unknown", 1] }), /Unsupported fixture/);
});

test("loopback fixture boundary serves real SDK query paths and rejects writes/unsupported queries", async () => {
  const server = fixtureSearchServer(rows).listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(url + "/health")).status, 200);
    const response = await fetch(url + "/v2/namespaces/tasks/query", {
      method: "POST", body: JSON.stringify({ rank_by, filters: ["projectId", "Eq", 1] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).rows.map(row => row.id), ["1", "3"]);
    const comments = await fetch(url + "/v2/namespaces/comments/query", { method: "POST", body: "{}" });
    assert.deepEqual(await comments.json(), { rows: [] });
    assert.equal((await fetch(url + "/v2/namespaces/tasks", { method: "POST", body: "{}" })).status, 404);
    assert.equal((await fetch(url + "/v2/namespaces/tasks/query", { method: "POST", body: '{"queries":[]}' })).status, 400);
    assert.equal((await fetch(url + "/v2/namespaces/tasks/query", { method: "POST", body: "invalid" })).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
