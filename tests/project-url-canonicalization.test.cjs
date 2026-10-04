const assert = require("node:assert/strict");
const fs = require("./refactored-module-source.cjs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/app/[...boardURL]/LandingPage.tsx"),
  "utf8"
);

test("project startup canonicalizes URL state with one replace site", () => {
  const start = source.indexOf("// Canonicalize id, view, and one-shot flags");
  const end = source.indexOf("// Retry fetching projects", start);
  assert.ok(start > 0 && end > start, "canonicalization block not found");
  const block = source.slice(start, end);

  assert.match(block, /params\.set\('id'/);
  assert.match(block, /params\.delete\("welcome_ai"\)/);
  assert.equal(
    (block.match(/router\.replace\(/g) ?? []).length,
    1,
    "startup URL fields must be committed by one navigation"
  );
});

test("canonicalization cannot overwrite a cold cached ticket URL while the board is still mounted", () => {
  const start = source.indexOf("// Canonicalize id, view, and one-shot flags");
  const end = source.indexOf("// Retry fetching projects", start);
  const block = source.slice(start, end);
  for (const [pathname, cachedTaskDetail, expectedWrites] of [
    ["/detail/project-1/1", { accountId: 985, taskId: 1 }, 0],
    ["/detail/project-1/1", undefined, 1],
    ["/project", { accountId: 985, taskId: 1 }, 1],
    ["/project", undefined, 1],
  ]) {
    const writes = [];
    const bindings = {
      useEffect: effect => effect(),
      window: { location: { pathname }, history: { state: { cachedTaskDetail }, replaceState: (...args) => writes.push(args) } },
      pathname,
      searchParams: new URLSearchParams(),
      slugs: 1,
      surfaceInitializedFor: "ready",
      surfaceInitializationKey: "ready",
      data: { updatedProjects: [{ id: 1, project_view: { allViews: [] } }] },
      projectIndex: 0,
      dataFetching: false,
      hydrationFailedProjectId: undefined,
      currentView: undefined,
      welcomeAiHandledRef: { current: false },
      isBoardPayloadHydrated: () => true,
      getViewFromProject: () => ({ type: "Default" }),
      getNextRouterAwareHistoryState: state => state,
      setAiChatAutoOpenSuppressed: () => {},
      setAiChatExplicitOpenAt: () => {},
      setShowAiChatInterface: () => {},
      router: { replace: (...args) => writes.push(args) },
    };
    new Function(...Object.keys(bindings), block)(...Object.values(bindings));
    assert.equal(writes.length, expectedWrites, `${pathname}: cached=${Boolean(cachedTaskDetail)}`);
  }
});

test("shared surface links initialize layout before canonicalization", () => {
  assert.match(
    source,
    /const resolvedLayout = resolveBoardLayoutFromSurface\([\s\S]*?requestedSurface[\s\S]*?setBoardLayout\(resolvedLayout\)[\s\S]*?setSurfaceInitializedFor\(surfaceInitializationKey\)/
  );
  assert.match(
    source,
    /surfaceInitializedFor !== surfaceInitializationKey\) return;/
  );
  assert.match(
    source,
    /const surfaceInitializationKey = `\$\{slugs\}:\$\{currentView \?\? 'default'\}:\$\{requestedSurface === 'board' \|\| requestedSurface === 'table' \? requestedSurface : 'inherit'\}`/,
    "surface initialization must reset when client-side board, saved-view, or shared-surface navigation changes"
  );
});

test("canonicalization preserves explicit surface intent without materializing inheritance", () => {
  const start = source.indexOf("// Canonicalize id, view, and one-shot flags");
  const end = source.indexOf("// Retry fetching projects", start);
  const block = source.slice(start, end);

  assert.match(block, /new URLSearchParams\(searchParams\.toString\(\)\)/);
  assert.doesNotMatch(block, /params\.(?:set|delete)\(['"]surface['"]/);
});

test("bare project URLs wait for view metadata before replacing", () => {
  const start = source.indexOf("// Canonicalize id, view, and one-shot flags");
  const end = source.indexOf("// Retry fetching projects", start);
  const block = source.slice(start, end);
  const metadataGuard = block.indexOf("if (!currentProject || (!viewMetadataReady && (dataFetching || waitingForBoardHydration))) return");
  const replace = block.indexOf("router.replace(");

  assert.ok(metadataGuard > 0, "canonicalization must wait until the view can be resolved");
  assert.ok(replace > metadataGuard, "the metadata guard must run before navigation");
  assert.match(
    block,
    /else if \(!viewMetadataReady && !viewSlug\)[\s\S]*?params\.set\('view', 'default'\)/,
    "a terminal missing-metadata state must still produce a canonical fallback",
  );
  assert.match(
    block,
    /!isBoardPayloadHydrated\(currentProject\)[\s\S]*?hydrationFailedProjectId !== currentProject\.id/,
    "fallback must wait for active-board hydration or its terminal failure",
  );
  assert.match(
    block,
    /if \(!currentProject \|\|/,
    "an unresolved project must stay in the existing lookup/retry flow",
  );
});
