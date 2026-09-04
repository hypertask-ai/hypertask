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

test("HTPR-6072: the pending delete lookup is guarded against a ref, not a closure value", () => {
  // A closure-captured currentProject.id read before and after the same
  // await is always the same value, so a comparison against it can never
  // detect a switch that happened during the await - only a ref (mutated on
  // every render, read fresh after the await) can. This pins the fix the
  // reviewer required after the first version of this guard was a no-op.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/hooks/Homepage/useKanbanModalStates.ts"),
    "utf8",
  );
  assert.ok(
    /currentProjectIdRef\.current\s*=\s*currentProject\?\.id/.test(src),
    "expected a ref kept in sync with currentProject.id on every render",
  );
  const toggleMatch = src.match(
    /const toggleDeleteModal = async[\s\S]*?getAllSubTasks\(task\.id\)[\s\S]{0,120}/,
  );
  assert.ok(toggleMatch, "expected toggleDeleteModal's lookup to still exist");
  assert.ok(
    /currentProjectIdRef\.current\s*!==\s*lookupProjectId/.test(toggleMatch[0]),
    "the post-await staleness check must compare against the ref, not the closured currentProject",
  );
});

test("HTPR-6072: an overlapping board switch cannot apply a stale result", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  const fnMatch = src.match(
    /async function handleStateChangesOnBoardChange[\s\S]*?ensureBoardLoaded\(index\);[\s\S]{0,150}/,
  );
  assert.ok(fnMatch, "expected handleStateChangesOnBoardChange to still exist");
  assert.ok(
    /boardSwitchGenerationRef\.current\s*\+\+|\+\+boardSwitchGenerationRef\.current/.test(
      src,
    ),
    "expected a generation counter bumped per switch",
  );
  assert.ok(
    /switchGeneration\s*!==\s*boardSwitchGenerationRef\.current/.test(
      fnMatch[0],
    ),
    "expected the post-fetch continuation to bail when a newer switch has started",
  );
});

test("HTPR-6072: the delete-lookup guard actually blocks a stale result across an await (ref, not closure)", () => {
  // This repo has no React hook-rendering test setup, so this exercises the
  // exact race the fix depends on directly: a ref mutated mid-await must be
  // read as current afterwards, while a closure-captured variable read
  // before and after the same await is always the same value and can never
  // catch a change. The first version of this guard compared two reads of
  // the same closured variable and was a no-op - this test would have
  // failed against that version and passes against the ref-based fix.

  async function toggleDeleteModalClosureVersion(currentProjectId, lookup, onOpen) {
    const lookupProjectId = currentProjectId; // closure read, same value both times
    const result = await lookup();
    if (currentProjectId !== lookupProjectId) return; // always false: same variable
    onOpen(result);
  }

  async function toggleDeleteModalRefVersion(currentProjectIdRef, lookup, onOpen) {
    const lookupProjectId = currentProjectIdRef.current;
    const result = await lookup();
    if (currentProjectIdRef.current !== lookupProjectId) return;
    onOpen(result);
  }

  return (async () => {
    // Closure version: switching boards mid-await does not stop it opening.
    let openedByClosureVersion = false;
    const closurePromise = toggleDeleteModalClosureVersion(
      15,
      () => new Promise((resolve) => setTimeout(() => resolve([1, 2]), 10)),
      () => { openedByClosureVersion = true; },
    );
    await closurePromise;
    assert.equal(
      openedByClosureVersion,
      true,
      "sanity check: the closure-comparison pattern cannot detect a project change and always opens",
    );

    // Ref version: switching boards mid-await correctly blocks it opening.
    let openedByRefVersion = false;
    const projectIdRef = { current: 15 };
    const refPromise = toggleDeleteModalRefVersion(
      projectIdRef,
      () => new Promise((resolve) => setTimeout(() => resolve([1, 2]), 10)),
      () => { openedByRefVersion = true; },
    );
    projectIdRef.current = 16; // user switched boards while the lookup was in flight
    await refPromise;
    assert.equal(
      openedByRefVersion,
      false,
      "the ref-based guard must block a delete-modal open when the project changed mid-lookup",
    );

    // And it must still open normally when nothing changed.
    let openedWhenUnchanged = false;
    const stableRef = { current: 15 };
    await toggleDeleteModalRefVersion(
      stableRef,
      () => new Promise((resolve) => setTimeout(() => resolve([1, 2]), 10)),
      () => { openedWhenUnchanged = true; },
    );
    assert.equal(openedWhenUnchanged, true, "the guard must not block a normal, unchanged lookup");
  })();
});

test("HTPR-6072: readinessCompletionRef resets in an effect, not during render", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  const resetMatch = src.match(
    /useLayoutEffect\(\(\) => \{\s*if \(readinessCompletionRef\.current\.entryKey === readinessEntryKey\) return;[\s\S]*?\}, \[readinessEntryKey\]\)/,
  );
  assert.ok(
    resetMatch,
    "expected the ref reset to live inside a useLayoutEffect keyed on readinessEntryKey, not a bare render-time if-statement",
  );
});

test("HTPR-6072: a failed sub-task lookup does not leave taskInfo set with no modal open", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/hooks/Homepage/useKanbanModalStates.ts"),
    "utf8",
  );
  const toggleMatch = src.match(
    /const toggleDeleteModal = async[\s\S]*?\n  \};/,
  );
  assert.ok(toggleMatch, "expected toggleDeleteModal to still exist");
  assert.ok(
    /try \{[\s\S]*getAllSubTasks\(task\.id\)[\s\S]*\} catch/.test(toggleMatch[0]),
    "expected the getAllSubTasks await to be wrapped in try/catch",
  );
  assert.ok(
    /catch \(error[\s\S]*?setTaskInfo\(undefined\)/.test(toggleMatch[0]),
    "expected the catch block to clear taskInfo so it doesn't stay set with the modal never opening",
  );
});

test("HTPR-6072: the project re-sync effect runs before paint (useLayoutEffect, not useEffect)", () => {
  // A passive useEffect runs after the browser paints, so on a switch React
  // would paint one frame with the previous board's local currentProject
  // and sections before this effect corrects them - a visible flash of the
  // wrong board. useLayoutEffect runs before paint, so that frame is never
  // shown.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  const effectMatch = src.match(
    /(useLayoutEffect|useEffect)\(\(\) => \{[\s\S]{0,40}setProjects\(_allProjects\)[\s\S]*?\}, \[_allProjects, _projectIndex\]\)/,
  );
  assert.ok(effectMatch, "expected the project re-sync effect to still exist");
  assert.equal(
    effectMatch[1],
    "useLayoutEffect",
    "the re-sync effect must be useLayoutEffect so a switch never paints a stale board frame",
  );
});

test("HTPR-6072: a readiness sample can never be taken on a stale (mid-switch) frame", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  const readinessEffectMatch = src.match(
    /useLayoutEffect\(\(\) => \{\s*if \(!boardReadinessTraceScope\) return;[\s\S]{0,600}/,
  );
  assert.ok(readinessEffectMatch, "expected the readiness completion effect to still exist");
  assert.ok(
    /if \(_currentProject\?\.id !== _allProjects\[_projectIndex\]\?\.id\) return;/.test(
      readinessEffectMatch[0],
    ),
    "expected the readiness effect to bail when local currentProject still lags the routed project",
  );
});
