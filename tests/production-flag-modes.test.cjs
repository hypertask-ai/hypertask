const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const load = () => import("../scripts/flags/production-flag-modes.mjs");
const defaults = { "htpr-1-a": "OWNER_AND_QA", "htpr-2-b": "EVERYONE", "htpr-3-c": "OWNER_ONLY" };
const now = new Date("2026-10-11T00:00:00.000Z");
const fresh = () => ({
  source: "https://app.hypertask.ai/api/admin/flags",
  capturedAt: "2026-10-10T00:00:00.000Z",
  modes: { "htpr-1-a": "OWNER_AND_QA", "htpr-2-b": "EVERYONE", "htpr-3-c": "OWNER_ONLY" },
});

test("the committed live switch copy lists every flag definition and is fresh", async () => {
  const { definitionDefaults, snapshotProblems, SNAPSHOT_PATH } = await load();
  const snapshot = JSON.parse(readFileSync(path.join(root, SNAPSHOT_PATH), "utf8"));
  assert.deepEqual(snapshotProblems(snapshot, definitionDefaults(root)), []);
});

test("an admin list gives exact live modes, and a flag without a stored row keeps its default", async () => {
  const { buildSnapshot } = await load();
  const snapshot = buildSnapshot(defaults, [{ key: "htpr-1-a", mode: "EVERYONE" }, { key: "gone", mode: "OFF" }], now);
  assert.deepEqual(snapshot.modes, { "htpr-1-a": "EVERYONE", "htpr-2-b": "EVERYONE", "htpr-3-c": "OWNER_ONLY" });
  assert.equal(snapshot.capturedAt, now.toISOString());
  assert.equal(snapshot.view, "admin");
});

test("the plain QA view marks released flags Everyone and never leaves a hidden bugfix on", async () => {
  const { buildSnapshot } = await load();
  const snapshot = buildSnapshot(defaults, { "htpr-1-a": true, "htpr-2-b": false, "htpr-3-c": false }, now);
  assert.deepEqual(snapshot.modes, { "htpr-1-a": "EVERYONE", "htpr-2-b": "OFF", "htpr-3-c": "OWNER_ONLY" });
});

test("output is sorted and stable", async () => {
  const { serialize } = await load();
  const text = serialize({ ...fresh(), modes: { "htpr-3-c": "OFF", "htpr-1-a": "OFF" } });
  assert.deepEqual(Object.keys(JSON.parse(text).modes), ["htpr-1-a", "htpr-3-c"]);
  assert.ok(text.endsWith("}\n"));
  assert.equal(serialize(JSON.parse(text)), text);
});

test("the check fails for a missing flag, a bad mode, a stale date and hand-edited order", async () => {
  const { snapshotProblems } = await load();
  assert.deepEqual(snapshotProblems(fresh(), defaults, now), []);
  const missing = fresh();
  delete missing.modes["htpr-2-b"];
  assert.match(snapshotProblems(missing, defaults, now).join("\n"), /missing flags: htpr-2-b/);
  assert.match(snapshotProblems({ ...fresh(), modes: { ...fresh().modes, "htpr-1-a": "MAYBE" } }, defaults, now).join("\n"), /invalid entry/);
  assert.match(snapshotProblems({ ...fresh(), capturedAt: "2026-09-01T00:00:00.000Z" }, defaults, now).join("\n"), /older than 14 days/);
  assert.match(snapshotProblems({ ...fresh(), capturedAt: undefined }, defaults, now).join("\n"), /capturedAt/);
  assert.match(snapshotProblems({ ...fresh(), modes: { "htpr-3-c": "OFF", "htpr-1-a": "OFF", "htpr-2-b": "OFF" } }, defaults, now).join("\n"), /not sorted/);
});

test("a flag that is new in code can be added with its default without touching the capture date", async () => {
  const { addMissingDefaults } = await load();
  const old = fresh();
  delete old.modes["htpr-2-b"];
  old.modes["htpr-1-a"] = "EVERYONE";
  const next = addMissingDefaults(old, defaults);
  assert.deepEqual(next.modes, { "htpr-1-a": "EVERYONE", "htpr-2-b": "EVERYONE", "htpr-3-c": "OWNER_ONLY" });
  assert.equal(next.capturedAt, old.capturedAt);
});

test("a difference from the live modes is reported", async () => {
  const { modeDifferences } = await load();
  const live = { modes: { "htpr-1-a": "EVERYONE", "htpr-2-b": "EVERYONE" } };
  assert.deepEqual(modeDifferences(fresh(), live), ["htpr-1-a: file OWNER_AND_QA, live EVERYONE"]);
});

test("reading live modes sends an agent session header only and rejects bad answers", async () => {
  const { readLive } = await load();
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, init.headers.Authorization]);
    return { ok: true, json: async () => ({ flags: [{ key: "htpr-1-a", mode: "OFF" }] }) };
  };
  assert.deepEqual(await readLive({ AGENT_TOKEN: "t" }, fetcher), [{ key: "htpr-1-a", mode: "OFF" }]);
  assert.deepEqual(calls, [["https://app.hypertask.ai/api/admin/flags", "Bearer t"]]);
  await assert.rejects(readLive({ AGENT_TOKEN: "t" }, async () => ({ ok: false, status: 404 })), /404/);
  await assert.rejects(readLive({ AGENT_TOKEN: "t" }, async () => ({ ok: true, json: async () => ({ flags: [{ key: "x", mode: "NOPE" }] }) })), /Invalid/);
});

test("no workflow reads repository secrets to generate the copy", () => {
  const text = readFileSync(path.join(root, "scripts/flags/production-flag-modes.mjs"), "utf8");
  assert.doesNotMatch(text, /secrets\./);
});
