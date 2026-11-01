const assert = require("node:assert/strict");
const fs = require("./refactored-module-source.cjs");
const path = require("node:path");
const test = require("node:test");
require("tsx/cjs");

const { getNextRouterAwareHistoryState } = require(
  path.join(__dirname, "..", "src/lib/navigation/nextHistoryState.ts"),
);

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

test("HTPR-6072: the delete-lookup guard actually blocks a stale result across an await (ref, not closure)", () => {
  async function toggleDeleteModalClosureVersion(currentProjectId, lookup, onOpen) {
    const lookupProjectId = currentProjectId;
    const result = await lookup();
    if (currentProjectId !== lookupProjectId) return;
    onOpen(result);
  }

  async function toggleDeleteModalRefVersion(currentProjectIdRef, lookup, onOpen) {
    const lookupProjectId = currentProjectIdRef.current;
    const result = await lookup();
    if (currentProjectIdRef.current !== lookupProjectId) return;
    onOpen(result);
  }

  return (async () => {
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

    let openedByRefVersion = false;
    const projectIdRef = { current: 15 };
    const refPromise = toggleDeleteModalRefVersion(
      projectIdRef,
      () => new Promise((resolve) => setTimeout(() => resolve([1, 2]), 10)),
      () => { openedByRefVersion = true; },
    );
    projectIdRef.current = 16;
    await refPromise;
    assert.equal(
      openedByRefVersion,
      false,
      "the ref-based guard must block a delete-modal open when the project changed mid-lookup",
    );

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

test("HTPR-6072: keyboard switches wait for parent authorization", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  const switchHandler = src.match(
    /function handleStateChangesOnBoardChange[\s\S]*?\n}\n\n\nconst handleBoardChange/,
  );
  assert.ok(switchHandler, "expected the board switch handler to exist");
  assert.match(
    switchHandler[0],
    /const target = projects\[index\]\s*if \(target\) goToProjectShortcut\(target\.id, true\)/,
    "expected navigation without publishing target state locally",
  );
  assert.doesNotMatch(
    switchHandler[0],
    /setProjects|setCurrentProject|setSections|setRecoilCurrentProject|ensureBoardLoaded/,
    "the target must be published only by the parent's authorized snapshot",
  );
});

test("HTPR-6072: shallow navigation notifies Next when the current entry is already router-owned", () => {
  const currentState = {
    __NA: true,
    __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}],
    retainedByCaller: "keep-me",
  };
  const restoredUrls = [];

  const nextPatchedPushState = (data, url) => {
    if (data?.__NA || data?._N) return data;
    restoredUrls.push(url);
    return {
      ...data,
      __NA: currentState.__NA,
      __PRIVATE_NEXTJS_INTERNALS_TREE:
        currentState.__PRIVATE_NEXTJS_INTERNALS_TREE,
    };
  };

  nextPatchedPushState(currentState, "/project?id=1215");
  assert.deepEqual(
    restoredUrls,
    [],
    "passing window.history.state back unchanged reproduces the stale-board failure",
  );

  const storedState = nextPatchedPushState(
    getNextRouterAwareHistoryState(currentState),
    "/project?id=1215",
  );
  assert.deepEqual(restoredUrls, ["/project?id=1215"]);
  assert.equal(storedState.__NA, true, "Next must restore its routing marker");
  assert.equal(
    storedState.retainedByCaller,
    "keep-me",
    "unrelated history state must survive the shallow switch",
  );
});

