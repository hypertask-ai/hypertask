const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const key = "htpr-7799-project-entry";
const read = file => fs.readFileSync(file, "utf8");
const boards = [
  { id: 408, ownerId: 182, teamId: null, status: "Normal" },
  { id: 339, ownerId: 6, teamId: "team-6", status: "Normal" },
  { id: 8423, ownerId: 6, teamId: "team-6", status: "Normal" },
];

async function checkPage({ id, accountId = 182, remembered, enabled = true, failed = false, available = boards, document = false } = {}) {
  const user = { id: accountId, displayName: `Account ${accountId}` };
  const calls = { first: [], validation: [] };
  const load = loader({
    "next/headers": { cookies: async () => ({ get: name => name === "nookies_user" ? { value: JSON.stringify(user) } : name === "previousBoard" && remembered ? { value: remembered } : undefined }) },
    "next/navigation": { redirect: url => { throw Object.assign(new Error("redirect"), { url }); }, notFound: () => { throw new Error("not found"); } },
    "@/lib/firstScreen/serverBoardDocument": { getServerBoardDocument: async () => document ? { data: { projectId: 339, user } } : null },
    "./LandingPage": { default: "board" },
    "./NoBoardsEmptyState": { default: "no-boards" },
    "../unauthorized/page": { default: "unavailable" },
    "@/utils/controllers/projects/getFirst": { default: async () => { assert.equal(enabled, false, "flagged entry must not auto-create a board"); return { json: { id: 339 } }; } },
    "@/lib/prisma": { default: { project: { findFirst: async query => {
      calls.first.push(query);
      if (failed) throw new Error("project lookup unavailable");
      assert.deepEqual(query.where.teamId, { not: null });
      return available.find(board => board.ownerId === query.where.ownerId && board.teamId !== null && board.status === query.where.status && (query.where.id === undefined || board.id === query.where.id)) ?? null;
    } } } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: userId => ({ ownerId: userId, teamId: { not: null } }) },
    "@/lib/boardRouteMetadata": { getProjectForValidation: async (userId, projectId) => {
      calls.validation.push([userId, projectId]);
      const project = available.find(board => board.id === Number(projectId) && board.ownerId === userId);
      return { success: Boolean(project), project };
    } },
    "@/lib/flags": { isFeatureEnabled: async (flag, userId) => { assert.equal(flag, key); assert.equal(userId, accountId); return enabled; } },
    "@/lib/flags/keys": { HTPR_7799_PROJECT_ENTRY_FLAG: key },
    "@/lib/auth/session": { SESSION_COOKIE: "unused", verifySession: () => ({ id: accountId }) },
    "@/lib/boardBootstrap/earlyBoardBootstrap": { buildEarlyBoardBootstrapScript: () => "" },
  });
  try {
    calls.result = await load("src/app/[...boardURL]/page.tsx").default({ params: Promise.resolve({ boardURL: ["project"] }), searchParams: Promise.resolve({ ...(id === undefined ? {} : { id }), surface: "table" }) });
  } catch (error) {
    if (!error.url) throw error;
    calls.redirect = error.url;
  }
  return calls;
}

test("182 never selects 6's remembered boards or its own teamless 408 for board API loading", async () => {
  for (const remembered of [undefined, "project-339|&|", "project-8423|&|", "project-408|&|"]) {
    const result = await checkPage({ remembered });
    assert.equal(result.redirect, undefined);
    assert.equal(result.result.type, "no-boards");
    assert.ok(result.first.every(query => query.where.ownerId === 182));
  }
});

test("no-id entry validates remembered access and falls back to a readable board without creating one", async () => {
  const available = [...boards, { id: 409, ownerId: 182, teamId: "team-182", status: "Normal" }];
  for (const id of [undefined, "undefined", "null", ""]) {
    const result = await checkPage({ id, remembered: "project-8423|&|", available });
    assert.equal(result.redirect, "/project?id=409&surface=table");
    assert.equal(result.first[0].where.id, 8423);
    assert.deepEqual(result.first[1].orderBy, { id: "asc" });
  }
  assert.equal((await checkPage({ failed: true })).result.type, "unavailable");
});

test("6 still opens 339 and 8423 explicitly and through remembered no-id entry", async () => {
  for (const id of [339, 8423]) {
    const explicit = await checkPage({ id: String(id), accountId: 6 });
    assert.equal(explicit.first.length, 0);
    assert.deepEqual(explicit.validation, [[6, String(id)]]);
    assert.equal(explicit.result.props.children[1].props.slugs, String(id));
    const remembered = await checkPage({ accountId: 6, remembered: `project-${id}|&|` });
    assert.equal(remembered.redirect, `/project?id=${id}&surface=table`);
    assert.equal(remembered.first.length, 1);
    assert.equal((await checkPage({ id: String(id) })).result.type, "unavailable");
  }
});

test("flag-off entry and authorized first-screen documents still work", async () => {
  const legacy = await checkPage({ accountId: 6, enabled: false });
  assert.equal(legacy.first.length, 0);
  assert.equal(legacy.validation.length, 1);
  const document = await checkPage({ id: "339", accountId: 6, document: true });
  assert.equal(document.result.type, "board");
  assert.equal(document.result.props.slugs, "339");
});

function renderBoardContent(overrides) {
  const source = read("src/app/[...boardURL]/LandingPage.tsx");
  const tree = ts.createSourceFile("LandingPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "LandingPage") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration);
  const statements = declaration.initializer.body.statements;
  const values = {
    BoardDocumentBoundary: ({ children }) => children,
    FirstScreenMobileChrome: () => null,
    Unauthorized: () => React.createElement("div", null, "unavailable"),
    NoBoardsEmptyState: () => React.createElement("div", null, "no-boards"),
    SectionComp: props => React.createElement("div", null, `board ${props._allProjects[0].id}`),
    user: { id: 182 }, projectEntryEnabled: true, projectsError: false, projectLookupFailed: false,
    currentBoardAccessStatus: "pending", dataFetching: false, fetchedData: undefined,
    data: undefined, boardRender: null, projectIndex: -1, hydrationFailedProjectId: null,
    notificationCount: undefined, EMPTY_NOTIFICATION_COUNT: {}, authenticated: true,
    isGuest: false, localDatabasePilotEnabled: false, connectOverlayEnabled: false,
    retryBoardHydration: () => {}, boardAccessKey: "182:408",
    ...overrides,
  };
  const js = ts.transpileModule(statements.at(-1).getText(tree), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function("require", "exports", ...Object.keys(values), js)(require, {}, ...Object.values(values));
}

test("board denial, request failure and missing-account data render existing unavailable UI, never black", () => {
  const view = mount();
  try {
    for (const state of [
      { currentBoardAccessStatus: "denied" },
      { projectsError: true },
      { projectLookupFailed: true },
      { fetchedData: { accountId: 6, updatedProjects: [boards[1]] } },
      { projectsError: true, currentBoardAccessStatus: "denied", boardRender: { projects: [boards[1]], projectIndex: 0 } },
    ]) {
      view.render(renderBoardContent(state));
      assert.equal(view.container.textContent, "unavailable");
    }
    view.render(renderBoardContent({ data: { updatedProjects: [] } }));
    assert.equal(view.container.textContent, "no-boards");
    view.render(renderBoardContent({ projectsError: true, currentBoardAccessStatus: "authorized", data: { updatedProjects: [boards[1]], dataOrigin: "indexeddb" }, projectIndex: 0 }));
    assert.equal(view.container.textContent.trim(), "Loading board…");
    view.render(renderBoardContent({ dataFetching: true }));
    assert.equal(view.container.textContent.trim(), "Loading board…");
    view.render(renderBoardContent({ projectEntryEnabled: false, projectsError: true }));
    assert.equal(view.container.textContent, "");
    for (const board of boards.slice(1)) {
      for (const projectsError of [false, true]) {
        view.render(renderBoardContent({ projectsError, currentBoardAccessStatus: "authorized", boardRender: { projects: [board], projectIndex: 0 } }));
        assert.equal(view.container.textContent, `board ${board.id}`);
      }
    }
  } finally { view.close(); }
});

test("entry shares board API access rules and missing-id first-screen startup delegates to it", () => {
  for (const file of ["src/app/[...boardURL]/page.tsx", "src/utils/controllers/projects/getAll.ts", "src/utils/controllers/projects/getBoardTasks.ts"]) {
    assert.match(read(file), /getProjectWhere\(/);
  }
  const source = read("src/lib/firstScreen/serverBoardDocument.ts");
  assert.match(source, /flags\[HTPR_7799_PROJECT_ENTRY_FLAG\][^\n]*projectId <= 0[^\n]*return null/);
  assert.ok(source.indexOf("flags[HTPR_7799_PROJECT_ENTRY_FLAG]") < source.indexOf("await getFirst(user.id)"));
});

test("project recovery has an access-classified QA default", () => {
  const flag = loader()("src/lib/flags/definitions/htpr-7799-project-entry.ts").default;
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.highRisk, "access");
  assert.ok(flag.releaseRisk.reason);
});

test("getFirst no longer returns teamless 408 or creates a board, while 6 retains readable boards", async () => {
  for (const accountId of [182, 6]) {
    const load = loader({
      "@/lib/prisma": { default: {
        user: { findUnique: async () => ({ id: accountId }) },
        project: { findFirst: async ({ where }) => boards.find(board => board.ownerId === where.ownerId && board.status === where.status && (!where.teamId || board.teamId !== null)) ?? null },
        $transaction: async () => assert.fail("read-only first-board lookup must not provision a board"),
      } },
      "@/lib/flags": { isFeatureEnabled: async () => true },
      "@/lib/flags/keys": { HTPR_7799_PROJECT_ENTRY_FLAG: key },
      "@/utils/controllers/projects/getAllIncludes": {
        getProjectWhere: ownerId => ({ ownerId, teamId: { not: null } }),
        projectContentAccessWhere: ownerId => ({ ownerId }),
      },
      "@/utils/helperFunctions/Views/BoardFilterSanitizer": { sanitizeProjectBoardFilters: project => project },
      "./createProjectWithStableName": {}, "./create": {},
      "./getAll": { getProjectViewInclude: () => ({}) },
      "@/lib/telemetry/savedWork": {},
    });
    const result = await load("src/utils/controllers/projects/getFirst.ts").default(accountId);
    assert.equal(result.status, 200);
    assert.equal(result.json?.id ?? null, accountId === 182 ? null : 339);
  }
});

test("route rendering exceptions use existing unavailable UI when enabled and preserve the old recovery when disabled", () => {
  for (const enabled of [true, false]) {
    const load = loader({
      "../unauthorized/page": { default: () => React.createElement("div", null, "unavailable") },
      "@/hooks/useFlag": { useFlag: () => enabled },
      "@/lib/flags/keys": { HTPR_7799_PROJECT_ENTRY_FLAG: key },
      "@/hooks/MultiPages/HTC/useSignout": { useSignout: () => ({ handleHardReset: async () => true }) },
      "next/navigation": { useRouter: () => ({ refresh() {} }) },
      "@tanstack/react-query": { useQueryClient: () => ({ clear() {} }) },
    });
    const view = mount();
    try {
      view.render(React.createElement(load("src/app/[...boardURL]/error.tsx").default));
      assert.equal(view.container.textContent.includes("unavailable"), enabled);
      assert.equal(view.container.querySelectorAll("button").length > 0, !enabled);
    } finally { view.close(); }
  }
});
