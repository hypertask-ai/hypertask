// HTPR-7198: GET /api/mcp/tasks?updated_since=not-a-date crashed Prisma with a 500.
// Bad date filters must answer 400 before the query is built.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(
  path.join(root, "src/lib/mcp/operations/tasks/operation.ts"),
  "utf8",
);
const listQuerySource = fs.readFileSync(path.join(root, "src/lib/mcp/listQuery.ts"), "utf8");

function slice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

function loadFinder() {
  const source = [
    slice(listQuerySource, "export function parseUpdatedSince", "export function parseNumericCursor"),
    slice(routeSource, "function findInvalidDateParam", "function isLabelIdParam"),
    "module.exports = { findInvalidDateParam };",
  ].join("\n");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", javascript)(loaded, loaded.exports);
  return loaded.exports.findInvalidDateParam;
}

test("names the first unparseable date filter", () => {
  const find = loadFinder();
  assert.equal(find({ updated_since: "not-a-date" }), "updated_since");
  assert.equal(find({ updated_since: "2026-10-14", created_since: "nope" }), "created_since");
  assert.equal(find({ due_date_before: "tomorrow-ish" }), "due_date_before");
});

test("accepts valid dates and missing filters", () => {
  const find = loadFinder();
  assert.equal(
    find({
      updated_since: "2026-10-14T03:00:00Z",
      created_since: "2026-10-14",
      due_date_before: undefined,
      due_date_after: "",
    }),
    null,
  );
});

test("the list handler rejects bad dates before building the Prisma where", () => {
  const check = routeSource.indexOf("findInvalidDateParam({");
  const query = routeSource.indexOf("gte: new Date(updatedSince)");
  assert.notEqual(check, -1);
  assert.ok(check < query, "date validation must run before the date filters are used");
  for (const name of ["updated_since", "created_since", "due_date_before", "due_date_after"]) {
    assert.match(routeSource.slice(check, check + 300), new RegExp(`${name}:`));
  }
});
