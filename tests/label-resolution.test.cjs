const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// matchLabelIds is the guard that decides whether a caller may name a label
// ("AI") instead of quoting its uuid. Before it existed, every name-based call
// resolved to zero labels and threw, which is what silently broke tag edits
// from the AI chat. Compile the real source so the test cannot drift from it.
function loadMatchLabelIds() {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/lib/mcp/tasks/services.ts"),
    "utf8"
  );
  const start = source.indexOf("export function matchLabelIds");
  assert.notEqual(start, -1, "matchLabelIds must exist in services.ts");
  const end = source.indexOf("export async function resolveLabelIds");
  const snippet = source.slice(start, end).replace("export function", "function");
  const js = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(`${js}; return matchLabelIds;`)();
}

const matchLabelIds = loadMatchLabelIds();

const LABELS = [
  { id: "2e164f24-uuid", value: "AI Task Writer" },
  { id: "098dbf4d-uuid", value: "AI" },
  { id: "32657035-uuid", value: "stale" },
  { id: "4927765d-uuid", value: null },
];

test("resolves a label by its exact name", () => {
  const { ids, unresolved } = matchLabelIds(LABELS, ["AI Task Writer"]);
  assert.deepEqual(ids, ["2e164f24-uuid"]);
  assert.deepEqual(unresolved, []);
});

test("resolves a label by uuid, as MCP callers already did", () => {
  const { ids, unresolved } = matchLabelIds(LABELS, ["32657035-uuid"]);
  assert.deepEqual(ids, ["32657035-uuid"]);
  assert.deepEqual(unresolved, []);
});

test("name matching ignores case and stray whitespace", () => {
  // The model echoes whatever the user typed, so "ai task writer" and
  // " AI " must land on the same labels as the canonical spelling.
  const { ids, unresolved } = matchLabelIds(LABELS, ["ai task writer", " AI "]);
  assert.deepEqual(ids, ["2e164f24-uuid", "098dbf4d-uuid"]);
  assert.deepEqual(unresolved, []);
});

test("a tag swap keeps the two tags distinct", () => {
  // The exact failing request: drop "AI Task Writer", add "AI".
  const remove = matchLabelIds(LABELS, ["AI Task Writer"]);
  const add = matchLabelIds(LABELS, ["AI"]);
  assert.deepEqual(remove.ids, ["2e164f24-uuid"]);
  assert.deepEqual(add.ids, ["098dbf4d-uuid"]);
  assert.notDeepEqual(remove.ids, add.ids);
});

test("reports unknown labels instead of silently dropping them", () => {
  // Silently ignoring an unknown label would let the model report success
  // while having changed nothing.
  const { ids, unresolved } = matchLabelIds(LABELS, ["AI", "Nonexistent"]);
  assert.deepEqual(ids, ["098dbf4d-uuid"]);
  assert.deepEqual(unresolved, ["Nonexistent"]);
});

test("deduplicates when a label is named twice", () => {
  const { ids } = matchLabelIds(LABELS, ["AI", "ai", "098dbf4d-uuid"]);
  assert.deepEqual(ids, ["098dbf4d-uuid"]);
});
