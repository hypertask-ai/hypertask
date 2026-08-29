const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { buildSearchUrl, defaultSearchArchiveStatus, SearchRequestGate } = jiti(
  path.join(root, "src/lib/searchArchive.ts")
);

test("main search excludes archived tasks by default", () => {
  assert.equal(defaultSearchArchiveStatus(false), "Normal");
});

test("the include toggle requests both open and archived tasks", () => {
  assert.equal(defaultSearchArchiveStatus(true), null);
});

test("search URLs preserve archived preference and resettable tabs", () => {
  assert.equal(
    buildSearchUrl("invoice", 2, true),
    "/search?searchTerm=invoice&index=2&includeArchived=1",
  );
  assert.equal(
    buildSearchUrl("", null, true),
    "/search?searchTerm=&includeArchived=1",
  );
});

test("only the newest overlapping search request may apply results", () => {
  const gate = new SearchRequestGate();
  const archivedRequest = gate.begin();
  const openOnlyRequest = gate.begin();

  assert.equal(gate.isLatest(archivedRequest), false);
  assert.equal(gate.isLatest(openOnlyRequest), true);
  gate.invalidate();
  assert.equal(gate.isLatest(openOnlyRequest), false);
});

test("the archived preference is shareable and the control is accessible", () => {
  const component = fs.readFileSync(
    path.join(root, "src/app/search/SearchComp.tsx"),
    "utf8"
  );

  assert.match(component, /type="checkbox"/);
  assert.match(component, />\s*Include archived\s*</);
});
