const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
let setup;
const stubs = new Map([
  [
    "src/lib/auth/getSessionUser.ts",
    { getSessionUser: async () => setup.session },
  ],
  [
    "src/lib/prisma.ts",
    {
      default: {
        project: {
          findMany: async () => {
            if (setup.projectError) throw setup.projectError;
            return setup.projectIds.map((id) => ({ id }));
          },
        },
      },
    },
  ],
  [
    "src/utils/controllers/projects/getAllIncludes.ts",
    { projectContentAccessWhere: (userId) => ({ ownerId: userId }) },
  ],
  [
    "src/utils/controllers/search/document.ts",
    {
      turbopufferGetDocuments: async (...args) => setup.onSearch(...args),
    },
  ],
  [
    "src/lib/flags.ts",
    {
      HTPR_6372_SEARCH_RANKING_FLAG: "htpr-6372-search-ranking",
      HTPR_6369_SEARCH_OPERATORS_FLAG: "htpr-6369-search-operators",
      HTPR_6370_SEARCH_CHIPS_FLAG: "htpr-6370-search-chips",
      HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG: "htpr-6688-search-autocomplete",
      HTPR_6865_SEARCH_LAYOUT_FLAG: "htpr-6865-search-layout",
      HTPR_6878_SEARCH_LABEL_SCOPE_FLAG: "htpr-6878-search-label-scope",
      HTPR_6881_SEARCH_FUZZY_PERSON_FLAG: "htpr-6881-search-fuzzy-person",
      HTPR_6880_SEARCH_COMMENTER_FLAG: "htpr-6880-search-commenter",
      HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG: "htpr-6882-search-match-highlights",
      isFeatureEnabled: async (key) => key === "htpr-6372-search-ranking" && (setup.rankingEnabled ?? false),
    },
  ],
]);
for (const [relativePath, exports] of stubs) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const handler = jiti(
  path.join(root, "src/pages/api/search/document.ts"),
).default;

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function call({
  session,
  accessibleProjectIds = [],
  body,
  onSearch = () => ({ status: 200 }),
  projectError,
  rankingEnabled = false,
}) {
  setup = {
    session,
    projectIds: accessibleProjectIds,
    onSearch,
    projectError,
    rankingEnabled,
  };
  const res = response();
  await handler({ method: "POST", body, headers: {} }, res);
  return res;
}

test("document search requires an authenticated user", async () => {
  const res = await call({
    session: null,
    body: { projectIds: [15], searchQuery: "release" },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "SESSION_REQUIRED");
});

test("document search rejects inaccessible projects", async () => {
  const res = await call({
    session: { userId: 6 },
    accessibleProjectIds: [15],
    body: { projectIds: [15, 16], searchQuery: "release" },
  });
  assert.equal(res.statusCode, 403);
});

test("document search passes normalized accessible project ids", async () => {
  let searchArgs;
  const res = await call({
    session: { userId: 6 },
    accessibleProjectIds: [15],
    body: {
      projectIds: [15, 15, "16"],
      searchQuery: "  release  ",
      archive: "Normal",
    },
    onSearch: (...args) => {
      searchArgs = args;
      return { status: 200 };
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(searchArgs.slice(0, 3), ["release", [15], "Normal"]);
  assert.equal(searchArgs[3].contextProjectId, undefined);
  assert.equal(typeof searchArgs[3].applyRelevanceCut, "boolean");
});

test("document search forwards a context board for the ranker to validate", async () => {
  let searchArgs;
  const res = await call({
    session: { userId: 6 },
    accessibleProjectIds: [15],
    body: {
      projectIds: [15],
      searchQuery: "inbox icon",
      contextProjectId: 339,
    },
    onSearch: (...args) => {
      searchArgs = args;
      return { status: 200 };
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(searchArgs[3].contextProjectId, 339);
  assert.equal(searchArgs[3].applyRelevanceCut, false);
});

test("document search enables the relevance cut when the flag is on", async () => {
  let searchArgs;
  const res = await call({
    session: { userId: 6 },
    accessibleProjectIds: [15],
    rankingEnabled: true,
    body: {
      projectIds: [15],
      searchQuery: "inbox icon",
    },
    onSearch: (...args) => {
      searchArgs = args;
      return { status: 200 };
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(searchArgs[3].applyRelevanceCut, true);
});

test("document search reports access lookup failures as server errors", async () => {
  const res = await call({
    session: { userId: 6 },
    body: { projectIds: [15], searchQuery: "release" },
    projectError: new Error("database unavailable"),
  });
  assert.equal(res.statusCode, 500);
});
