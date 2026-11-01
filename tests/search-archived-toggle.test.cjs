const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  boardContextFromPath,
  buildSearchUrl,
  defaultSearchArchiveStatus,
  SearchRequestGate,
} = jiti(path.join(root, "src/lib/searchArchive.ts"));
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")
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
  assert.equal(
    buildSearchUrl("", null, false, 15),
    "/search?searchTerm=&fromProject=15"
  );
  assert.equal(buildSearchUrl("", null, false, null), "/search?searchTerm=");
  assert.equal(boardContextFromPath("/detail/project-15/6365"), 15);
  assert.equal(boardContextFromPath("/detail/project-12-invalid"), null);
  assert.equal(boardContextFromPath("/project", 15), 15);
  assert.equal(boardContextFromPath("/projects", 15), null);
  assert.equal(boardContextFromPath("/inbox", 15), null);
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

test("the search command toggles archived results with G then X", () => {
  const commandsFor = (includeArchived) =>
    getAllCommands({
      context: "Others",
      searchOptions: { includeArchived },
    }).flatMap((group) => group.commandLists);
  const commandFor = (includeArchived) =>
    commandsFor(includeArchived).find(
      (command) => command.key === "toggleArchivedSearchResults"
    );

  assert.deepEqual(commandFor(false).keyboard, ["G", null, "X"]);
  assert.equal(commandFor(false).name, "Show archived search results");
  assert.equal(commandFor(true).name, "Hide archived search results");
  assert.equal(
    commandsFor(false).some(
      (command) => command.key === "toggleArchivedOnBoard"
    ),
    false
  );
  assert.equal(
    getAllCommands({ context: "Others" })
      .flatMap((group) => group.commandLists)
      .some((command) => command.key === "toggleArchivedSearchResults"),
    false
  );
});
