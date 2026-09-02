const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const originalCache = new Map(Object.entries(require.cache));
let activeFixture;

const prisma = {
  view: {
    findFirst: async (args) => {
      activeFixture.calls.findFirst.push(args);
      return activeFixture.targetView;
    },
  },
  view_Last_Used: {
    upsert: async (args) => {
      activeFixture.calls.upsert.push(args);
      return args.create;
    },
  },
};

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

class BoardFilterError extends Error {}
stubModule("src/lib/prisma.ts", { __esModule: true, default: prisma });
stubModule("src/lib/realtime/server.ts", { broadcastBoardChange: () => undefined });
stubModule("src/models/Views/model.ts", {
  isBoardEmptySectionSetting: (value) => value === "Show" || value === "Hidden",
  PERSONAL_EMPTY_SECTIONS_UPDATE_MODE: "personal-empty-sections",
});
stubModule("src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts", {
  __esModule: true,
  default: async () => ({}),
});
stubModule("src/utils/helperFunctions/Views/BoardFilterSanitizer.ts", {
  sanitizeBoardFilters: (value) => value,
});
stubModule("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts", {
  sanitizeBoardLayout: (value) => value,
  sanitizeTableSort: () => ({ column: null, direction: null }),
});
stubModule("src/utils/controllers/projects/views/boardFilterWriteLock.ts", {
  assertViewIsNotManagedSmartSplit: async () => undefined,
  ManagedSmartSplitMutationError: BoardFilterError,
  MissingBoardFilterLabelError: BoardFilterError,
  withBoardFilterWriteLock: async (_projectId, _filters, operation) =>
    operation(prisma),
});

const jiti = require("jiti")(path.join(root, "tests/personal-empty-sections-route.test.cjs"), {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const routeModule = jiti(
  path.join(root, "src/pages/api/projects/views/update-view.ts"),
);
const routeHandler = routeModule.default ?? routeModule;

function loadHandler({ targetView = { id: "speed" } } = {}) {
  const fixture = {
    calls: { findFirst: [], upsert: [] },
    targetView,
  };
  return {
    calls: fixture.calls,
    handler: async (req, res) => {
      activeFixture = fixture;
      return routeHandler(req, res);
    },
  };
}

test.after(() => {
  for (const filename of Object.keys(require.cache)) {
    if (!originalCache.has(filename)) delete require.cache[filename];
  }
  for (const [filename, original] of originalCache) {
    require.cache[filename] = original;
  }
});

function response() {
  const result = { statusCode: null, body: null };
  const res = {
    status(code) {
      result.statusCode = code;
      return res;
    },
    json(body) {
      result.body = body;
      return res;
    },
  };
  return { result, res };
}

function request({
  method = "POST",
  userId = 6,
  cookie = JSON.stringify({ id: userId }),
  projectId = 15,
  viewId = "speed",
  setting = "Hidden",
} = {}) {
  return {
    method,
    cookies: cookie === undefined ? {} : { nookies_user: cookie },
    body: {
      projectId,
      viewId,
      updateMode: "personal-empty-sections",
      view_settings: { board_empty_sections: setting },
    },
  };
}

async function call(handler, req) {
  const { result, res } = response();
  await handler(req, res);
  return result;
}

test("personal empty-column visibility writes only the authenticated user's view preference", async () => {
  const { handler, calls } = loadHandler();
  const result = await call(handler, request());

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    viewId: "speed",
    board_empty_sections: "Hidden",
  });
  assert.equal(calls.upsert.length, 1);
  assert.deepEqual(calls.upsert[0], {
    create: {
      userId: 6,
      viewId: "speed",
      board_empty_sections: "Hidden",
    },
    update: { board_empty_sections: "Hidden" },
    where: {
      user_view_last_used: { userId: 6, viewId: "speed" },
    },
  });
  assert.equal("lastUsedAt" in calls.upsert[0].create, false);

  const where = calls.findFirst[0].where;
  assert.equal(where.id, "speed");
  assert.equal(where.project_view.projectId, 15);
  assert.deepEqual(where.OR, [
    { visibility: "Public" },
    { userId: 6 },
  ]);
  assert.deepEqual(where.project_view.project.OR, [
    { ownerId: 6 },
    { members: { some: { userId: 6, status: "Accepted" } } },
  ]);
});

test("preferences are isolated by authenticated user and saved view", async () => {
  const first = loadHandler();
  const second = loadHandler();

  await call(first.handler, request({ userId: 6, viewId: "speed" }));
  await call(second.handler, request({ userId: 7, viewId: "bugs" }));

  assert.deepEqual(
    first.calls.upsert[0].where.user_view_last_used,
    { userId: 6, viewId: "speed" },
  );
  assert.deepEqual(
    second.calls.upsert[0].where.user_view_last_used,
    { userId: 7, viewId: "bugs" },
  );
});

test("the route rejects cross-board or inaccessible views before writing", async () => {
  const { handler, calls } = loadHandler({ targetView: null });
  const result = await call(handler, request({ viewId: "other-board-view" }));

  assert.equal(result.statusCode, 404);
  assert.equal(calls.upsert.length, 0);
});

test("the route rejects invalid settings and unauthenticated callers", async () => {
  const invalid = loadHandler();
  const invalidResult = await call(
    invalid.handler,
    request({ setting: "Hide" }),
  );
  assert.equal(invalidResult.statusCode, 400);
  assert.equal(invalid.calls.upsert.length, 0);

  const unsigned = loadHandler();
  const unsignedResult = await call(
    unsigned.handler,
    { ...request(), cookies: {} },
  );
  assert.equal(unsignedResult.statusCode, 401);
  assert.equal(unsigned.calls.findFirst.length, 0);
  assert.equal(unsigned.calls.upsert.length, 0);

  const malformed = loadHandler();
  const malformedResult = await call(
    malformed.handler,
    request({ cookie: "not-json" }),
  );
  assert.equal(malformedResult.statusCode, 401);
  assert.equal(malformed.calls.findFirst.length, 0);

  const nullCookie = loadHandler();
  const nullCookieResult = await call(
    nullCookie.handler,
    request({ cookie: "null" }),
  );
  assert.equal(nullCookieResult.statusCode, 401);
  assert.equal(nullCookie.calls.findFirst.length, 0);
});

test("the route rejects unsupported methods without touching data", async () => {
  const { handler, calls } = loadHandler();
  const result = await call(handler, request({ method: "GET" }));

  assert.equal(result.statusCode, 405);
  assert.equal(calls.findFirst.length, 0);
  assert.equal(calls.upsert.length, 0);
});
