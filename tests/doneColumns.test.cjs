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

test("Live with a null isDone flag is finished by name", () => {
  const doneTitles = doneColumnTitles([
    { section_title: "Live", isDone: null },
  ]);

  assert.equal(isDoneColumn("Live", doneTitles), true);
});

test("Ship it with isDone true is finished without a keyword match", () => {
  const doneTitles = doneColumnTitles([
    { section_title: "Ship it", isDone: true },
  ]);

  assert.equal(isDoneByName("Ship it"), false);
  assert.equal(isDoneColumn("Ship it", doneTitles), true);
});

test("Done with isDone false is not done under either fallback", () => {
  const section = { section_title: "Done", isDone: false };

  for (const fallback of [velocityDoneNameFallback, mcpDoneNameFallback]) {
    const doneTitles = doneColumnTitles([section], fallback);
    assert.equal(isDoneColumn("Done", doneTitles, fallback), false);
  }
});

test("isDoneColumn without a set behaves exactly like name matching", () => {
  for (const title of [null, "", "Done", " LIVE ", "Ship it", "Not done"]) {
    assert.equal(isDoneColumn(title), isDoneByName(title));
  }
});

test("isDoneColumn treats a title absent from a supplied set as unfinished", () => {
  assert.equal(isDoneColumn("Done", new Set(["ship it"])), false);
});

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

test("Done WIN with isDone true is done under both fallbacks", () => {
  const section = { section_title: "Done WIN", isDone: true };

  for (const fallback of [velocityDoneNameFallback, mcpDoneNameFallback]) {
    const doneTitles = doneColumnTitles([section], fallback);
    assert.equal(isDoneColumn(section.section_title, doneTitles, fallback), true);
  }
  assert.equal(columnRoleFor(section), "done");
});
