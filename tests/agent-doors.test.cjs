const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const load = () => import(path.join(root, "scripts/agent-doors.mjs"));

test("every Ctrl+K command belongs to an audited person action", async () => {
  const { build } = await load();
  const result = build();
  assert.deepEqual(result.unmapped, [], "new commands need a row in docs/agent-doors.tsv");
  assert.ok(result.rows.length > 200, `expected the whole palette, saw ${result.rows.length} commands`);
});

test("a mapped door still exists in code", async () => {
  const { build } = await load();
  const result = build();
  assert.deepEqual(result.broken, [], "a door path or AI chat tool no longer exists");
});

test("an audited action is reachable from the palette", async () => {
  const { build } = await load();
  const result = build();
  assert.deepEqual(result.empty, [], "actions with no command should be removed from the table");
});

test("docs/agent-doors.tsv matches the audited table", async () => {
  const { build, doorTable } = await load();
  const { actions } = build();
  const onDisk = readFileSync(path.join(root, "docs/agent-doors.tsv"), "utf8");
  assert.equal(onDisk, doorTable([...actions.values()]), "run node scripts/agent-doors.mjs --write");
});

