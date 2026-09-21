const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;

class ManagedSmartSplitMutationError extends Error {
  constructor() {
    super("Manage this smart split from Manage views");
    this.status = 409;
  }
}

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

const load = (relativePath, stubs) => {
  delete require.cache[path.join(root, relativePath)];
  for (const [stubPath, exports] of Object.entries(stubs)) {
    delete require.cache[path.join(root, stubPath)];
    stubModule(stubPath, exports);
  }
  const jiti = require("jiti")(
    path.join(root, `tests/smart-split-view-mutation-${++loadId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(path.join(root, relativePath));
};

const response = () => {
  const result = { statusCode: null, body: null };
  return {
    result,
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
};

const guardStub = (prisma) => ({
  ManagedSmartSplitMutationError,
  MissingBoardFilterLabelError: class extends Error {},
  withBoardFilterWriteLock: async (_projectId, _filters, operation) => operation(prisma),
  assertViewIsNotManagedSmartSplit: async () => {
    throw new ManagedSmartSplitMutationError();
  },
});

test("create-view overwrite returns 409 before mutating a smart split", async () => {
  let writes = 0;
  const prisma = {
    project: {
      findFirst: async () => ({ id: 15 }),
    },
    view: {
      findFirst: async () => ({ id: "split-1", title: "Quick wins" }),
      create: async () => { writes += 1; },
      update: async () => { writes += 1; },
    },
    project_View: {
      upsert: async () => ({ id: "project-view-15", default_view: null }),
    },
  };
  const route = load("src/pages/api/projects/views/create-view.ts", {
    "src/lib/prisma.ts": { default: prisma },
    "src/lib/realtime/server.ts": { broadcastBoardChange: () => undefined },
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts": {
      default: async () => ({}),
      getUniqueSlug: async () => "quick-wins",
    },
    "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts": {
      sanitizeBoardFilters: (value) => value,
    },
    "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts": {
      sanitizeTableSort: () => ({ column: null, direction: null }),
    },
    "src/utils/controllers/projects/views/boardFilterWriteLock.ts": guardStub(prisma),
  }).default;
  const res = response();

  await route({
    method: "POST",
    cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    body: {
      projectId: 15,
      viewTitle: "Quick wins",
      visibility: "Public",
      setAsDefault: false,
      view_settings: { board_filters: { addedFilters: [] } },
    },
  }, res);

  assert.equal(res.result.statusCode, 409);
  assert.match(res.result.body.message, /manage this smart split/i);
  assert.equal(writes, 0);
});

test("private saves never select a same-title public team view", async () => {
  let titleLookup;
  const prisma = {
    project: {
      findFirst: async () => ({ id: 15 }),
    },
    view: {
      findFirst: async ({ where }) => {
        titleLookup = where;
        return null;
      },
    },
    project_View: {
      upsert: async () => {
        throw new Error("stop after title lookup");
      },
    },
  };
  const route = load("src/pages/api/projects/views/create-view.ts", {
    "src/lib/prisma.ts": { default: prisma },
    "src/lib/realtime/server.ts": { broadcastBoardChange: () => undefined },
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts": {
      default: async () => ({}),
      getUniqueSlug: async () => "mine",
    },
    "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts": {
      sanitizeBoardFilters: (value) => value,
    },
    "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts": {
      sanitizeTableSort: () => ({ column: null, direction: null }),
    },
    "src/utils/controllers/projects/views/boardFilterWriteLock.ts": guardStub(prisma),
  }).default;
  const res = response();

  await route({
    method: "POST",
    cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    body: {
      projectId: 15,
      viewTitle: "Weekly",
      visibility: "Private",
      setAsDefault: false,
      view_settings: { board_filters: { addedFilters: [] } },
    },
  }, res);

  assert.equal(titleLookup.userId, 6);
  assert.equal(titleLookup.visibility, "Private");
  assert.equal(titleLookup.OR, undefined);
});

test("update-view returns 409 before mutating a smart split", async () => {
  let writes = 0;
  const prisma = {
    view: {
      findFirst: async () => ({ id: "split-1" }),
      update: async () => { writes += 1; },
    },
    project_View: {
      upsert: async () => ({ id: "project-view-15" }),
    },
  };
  const route = load("src/pages/api/projects/views/update-view.ts", {
    "src/lib/prisma.ts": { default: prisma },
    "src/lib/realtime/server.ts": { broadcastBoardChange: () => undefined },
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts": {
      default: async () => ({}),
    },
    "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts": {
      sanitizeBoardFilters: (value) => value,
    },
    "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts": {
      sanitizeTableSort: () => ({ column: null, direction: null }),
    },
    "src/utils/controllers/projects/views/boardFilterWriteLock.ts": guardStub(prisma),
  }).default;
  const res = response();

  await route({
    method: "POST",
    cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    body: {
      projectId: 15,
      viewId: "split-1",
      view_settings: { board_filters: { addedFilters: [] } },
    },
  }, res);

  assert.equal(res.result.statusCode, 409);
  assert.match(res.result.body.message, /manage this smart split/i);
  assert.equal(writes, 0);
});

test("MCP update and delete reject smart splits before any write", async () => {
  const writes = [];
  const view = {
    id: "split-1",
    title: "Quick wins",
    userId: 6,
    visibility: "Public",
    board_filters: { addedFilters: [] },
    board_sorting_mode: "Manual",
    project_view: {
      id: "project-view-15",
      projectId: 15,
      default_view_id: "default-view",
    },
  };
  const tx = {
    view: {
      update: async () => { writes.push("view-update"); },
      deleteMany: async () => { writes.push("view-delete"); return { count: 1 }; },
    },
    project_View: { update: async () => { writes.push("default-update"); } },
    user_Project_View: {
      updateMany: async () => { writes.push("pointer-update"); },
    },
    view_Last_Used: {
      deleteMany: async () => { writes.push("last-used-delete"); },
    },
  };
  const prisma = {
    view: { findUnique: async () => view },
    $transaction: async (operation) => operation(tx),
  };
  const services = load("src/lib/mcp/views/services.ts", {
    "src/lib/prisma.ts": { default: prisma },
    "src/lib/mcp/tasks/services.ts": {
      matchLabelIds: () => ({ ids: [], unresolved: [] }),
      validateProjectAccess: async () => ({}),
      validateProjectMemberIds: async () => ({ invalidIds: [] }),
    },
    "src/lib/realtime/server.ts": { broadcastBoardChange: () => undefined },
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts": {
      getUniqueSlug: async () => "quick-wins",
      getViewUrl: () => null,
    },
    "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts": {
      sanitizeBoardFilters: (value) => value,
    },
    "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts": {
      sanitizeSortingStack: (value) => value,
    },
    "src/utils/controllers/projects/views/boardFilterWriteLock.ts": {
      acquireBoardFilterWriteLock: async () => undefined,
      assertViewIsNotManagedSmartSplit: async () => {
        throw new ManagedSmartSplitMutationError();
      },
      validateBoardFilterLabelReferences: async () => undefined,
      withBoardFilterWriteLock: async (_projectId, _filters, operation) => operation(tx),
    },
  });

  await assert.rejects(
    services.updateView({ viewId: view.id, userId: 6, sorting_mode: "Manual" }),
    /manage this smart split/i,
  );
  await assert.rejects(
    services.deleteView(view.id, 6),
    /manage this smart split/i,
  );
  assert.deepEqual(writes, []);
});
