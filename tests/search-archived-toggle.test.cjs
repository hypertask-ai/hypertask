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

test("archived results move off-canvas into search commands", () => {
  const component = fs.readFileSync(
    path.join(root, "src/app/search/SearchComp.tsx"),
    "utf8"
  );

  assert.doesNotMatch(component, /type="checkbox"/);
  assert.match(component, /searchOptions: \{ includeArchived \}/);
  assert.match(component, /callbackHandler=\{handleCommand\}/);
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

  const hook = fs.readFileSync(
    path.join(root, "src/hooks/Search/useSearch.ts"),
    "utf8"
  );
  assert.match(hook, /event\.keyCode === KeyCodes\.X/);
  assert.match(hook, /setIncludeArchivedResults\(!includeArchived\)/);

  const shortcuts = fs.readFileSync(
    path.join(root, "src/lib/constants/shortcuts.ts"),
    "utf8"
  );
  assert.match(
    shortcuts,
    /Show or hide archived tasks", pressKey: \["G", null, "X"\]/
  );

  const mobileIcons = fs.readFileSync(
    path.join(root, "src/components/Modals/commands/HTC/MobileCommandIcon.tsx"),
    "utf8"
  );
  assert.match(
    mobileIcons,
    /case CommandMode\.ToggleArchivedSearchResults:\s*return Archive;/
  );
});
