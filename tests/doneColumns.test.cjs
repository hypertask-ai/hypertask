const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/doneColumns-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  doneColumnTitles,
  isDoneByName,
  isDoneColumn,
} = jiti(path.join(root, "src/lib/doneColumns.ts"));
const { columnRole, columnRoleFor } = jiti(
  path.join(root, "src/lib/mcp/boards/columnRole.ts")
);

const velocityDoneNameFallback = isDoneByName;
const mcpDoneNameFallback = (title) => columnRole(title) === "done";

// Legacy boards rely on name inference until their nullable flag is explicitly set.
test("Live with a null isDone flag is finished by name", () => {
  const doneTitles = doneColumnTitles([
    { section_title: "Live", isDone: null },
  ]);

  assert.equal(isDoneColumn("Live", doneTitles), true);
});

// Explicit flags let boards finish work in columns whose names have no legacy keyword.
test("Ship it with isDone true is finished without a keyword match", () => {
  const doneTitles = doneColumnTitles([
    { section_title: "Ship it", isDone: true },
  ]);

  assert.equal(isDoneByName("Ship it"), false);
  assert.equal(isDoneColumn("Ship it", doneTitles), true);
});

// WHY: An explicit false flag must override every consumer's matching name fallback.
test("Done with isDone false is not done under either fallback", () => {
  const section = { section_title: "Done", isDone: false };

  for (const fallback of [velocityDoneNameFallback, mcpDoneNameFallback]) {
    const doneTitles = doneColumnTitles([section], fallback);
    assert.equal(isDoneColumn("Done", doneTitles, fallback), false);
  }
});

// Callers without board metadata must preserve the exact legacy name-matching fallback.
test("isDoneColumn without a set behaves exactly like name matching", () => {
  for (const title of [null, "", "Done", " LIVE ", "Ship it", "Not done"]) {
    assert.equal(isDoneColumn(title), isDoneByName(title));
  }
});

// A supplied set is authoritative so missing titles cannot be inferred as finished by name.
test("isDoneColumn treats a title absent from a supplied set as unfinished", () => {
  assert.equal(isDoneColumn("Done", new Set(["ship it"])), false);
});

// Duplicate names need deterministic resolution because tasks store only the column title.
test("same-named columns resolve to finished regardless of array order", () => {
  const explicitlyOpen = { section_title: "Ship it", isDone: false };
  const explicitlyFinished = { section_title: "Ship it", isDone: true };

  for (const sections of [
    [explicitlyOpen, explicitlyFinished],
    [explicitlyFinished, explicitlyOpen],
  ]) {
    assert.equal(
      isDoneColumn("Ship it", doneColumnTitles(sections)),
      true
    );
  }
});

// MCP manifests must not advertise an explicitly open Done column as terminal.
test("columnRoleFor suppresses the name-based done role when isDone is false", () => {
  assert.equal(
    columnRoleFor({ section_title: "Done", isDone: false }),
    "other"
  );
  assert.equal(
    columnRoleFor({ section_title: "Done review", isDone: false }),
    "human-review"
  );
});

test("MCP keyword roles preserve their historical ordered classification", () => {
  const cases = [
    { section_title: "Finished", isDone: null, role: "other" },
    { section_title: "Work complete", isDone: null, role: "done" },
    { section_title: "Done review", isDone: null, role: "human-review" },
    { section_title: "Backlog", isDone: null, role: "backlog" },
  ];

  for (const section of cases) {
    assert.equal(columnRoleFor(section), section.role, section.section_title);
  }
});

// WHY: MCP must retain the 28 live keyword-matched columns without changing velocity.
test("Done WIN with a null flag differs between MCP and velocity on purpose", () => {
  const section = { section_title: "Done WIN", isDone: null };
  const mcpDoneTitles = doneColumnTitles([section], mcpDoneNameFallback);
  const velocityDoneTitles = doneColumnTitles(
    [section],
    velocityDoneNameFallback
  );

  assert.equal(isDoneColumn(section.section_title, null, mcpDoneNameFallback), true);
  assert.equal(
    isDoneColumn(section.section_title, null, velocityDoneNameFallback),
    false
  );
  assert.equal(
    isDoneColumn(section.section_title, mcpDoneTitles, mcpDoneNameFallback),
    true
  );
  assert.equal(
    isDoneColumn(
      section.section_title,
      velocityDoneTitles,
      velocityDoneNameFallback
    ),
    false
  );
  assert.equal(columnRoleFor(section), "done");
});

// WHY: The explicit flag is the shared rule even when consumer name fallbacks differ.
test("Done WIN with isDone true is done under both fallbacks", () => {
  const section = { section_title: "Done WIN", isDone: true };

  for (const fallback of [velocityDoneNameFallback, mcpDoneNameFallback]) {
    const doneTitles = doneColumnTitles([section], fallback);
    assert.equal(isDoneColumn(section.section_title, doneTitles, fallback), true);
  }
  assert.equal(columnRoleFor(section), "done");
});
