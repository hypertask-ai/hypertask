const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// HTPR-6072: SectionComp used to be keyed by readinessRouteEntryId, so React
// fully unmounted and rebuilt the whole board tree on every switch - even
// with a warm local copy - purely to give the readiness telemetry (PR #2765,
// HTPR-5432) a clean trace per route entry. That reset is already available
// without a remount: prepareBoardReadinessTrace (boardReadinessPhases.ts)
// keys its runtime by routeEntryId/generation on its own. This pins the key
// staying gone so a future edit can't silently reintroduce the remount.

test("HTPR-6072: SectionComp is not keyed by the readiness route entry id", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  const sectionCompUsage = src.slice(
    src.indexOf("<SectionComp"),
    src.indexOf("<SectionComp") + 400,
  );
  assert.ok(
    !/key=\{readinessRouteEntryId\}/.test(sectionCompUsage),
    "SectionComp must not remount on a board switch - the readiness trace already resets via routeEntryId, not via a DOM key",
  );
});

test("HTPR-6072: local project state re-syncs on projectIndex alone, not just a new project list", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  // Without the remount, this effect is the only thing that re-derives
  // sections/currentProject/currentIndex for the newly selected board - it
  // must depend on _projectIndex, not just on _allProjects (which is often
  // the same array reference across a switch between two boards).
  const effectMatch = src.match(
    /setSections\(_allProjects\[_projectIndex\]\.sections\)[\s\S]{0,80}\}, \[([^\]]+)\]\)/,
  );
  assert.ok(effectMatch, "expected the project re-sync effect to still exist");
  assert.ok(
    /_projectIndex/.test(effectMatch[1]),
    "the re-sync effect must depend on _projectIndex",
  );
});

test("HTPR-6072: board-level modals close on a project change instead of relying on a remount", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/hooks/Homepage/useKanbanModalStates.ts"),
    "utf8",
  );
  assert.ok(
    /useEffect\(\(\) => \{[\s\S]*setShowDeleteTaskModal\(false\)[\s\S]*\}, \[currentProject\?\.id\]\)/.test(
      src,
    ),
    "expected an effect keyed on currentProject?.id that closes the board modals",
  );
});
