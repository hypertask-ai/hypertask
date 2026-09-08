// HTPR-6261. The mention endpoints used to keep only the first five board
// agents before rendering the Agents group. Because the shared membership
// query had no order, a different matching agent could disappear on each
// keystroke. Exercise both callers so a cap cannot creep back into either one.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const agentRows = [
  ["z", "inne Zebra"],
  ["a-2", "inne Alpha"],
  ["manager", "inne Agent Manager"],
  ["delta", "inne Delta"],
  ["a-1", "inne Alpha"],
  ["beta", "inne Beta"],
].map(([id, displayName]) => ({
  id: `member-${id}`,
  agent: {
    id,
    userId: 6,
    displayName,
    photoURL: null,
  },
  user: { id: 6, displayName: "Valentin Yeo" },
}));

const expectedAgentIds = ["manager", "a-1", "a-2", "beta", "delta", "z"];
const state = {
  accessibleProjectIds: [339],
  boardAgentCalls: 0,
};

const people = Array.from({ length: 7 }, (_, index) => ({
  id: index + 20,
  displayName: `Person ${index}`,
}));
const projects = Array.from({ length: 5 }, (_, index) => ({
  id: index + 1,
  title: `Board ${index}`,
  uniqueIdentifier: `B${index}`,
}));
const tasks = Array.from({ length: 5 }, (_, index) => ({
  id: index + 100,
  title: `Task ${index}`,
  uniqueIndex: index,
  projectId: 339,
  ticketNumber: `TEST-${index}`,
  updatedAt: new Date(2026, 0, index + 1),
}));

stubModule("src/lib/prisma.ts", {
  default: {
    project: {
      findMany: async ({ select } = {}) =>
        select?.id
          ? state.accessibleProjectIds.map((id) => ({ id }))
          : projects,
      findFirst: async () => ({
        owner: people[0],
        members: people.slice(1).map((user) => ({ user })),
      }),
    },
    user: { findFirst: async () => ({ id: 332, displayName: "HyperAI" }) },
    task: { findMany: async () => tasks },
    page: { findMany: async () => [] },
  },
});
stubModule("src/lib/aiModelOptions.ts", {
  aiImageModelDefinitions: [],
  aiModelDefinitions: [],
});
stubModule("src/lib/flags.ts", {
  isFeatureEnabled: async () => false,
  PAGE_MENTIONS_FLAG: "htpr-5898-page-mentions",
});
stubModule("src/utils/controllers/agents/boardMembers.ts", {
  getBoardAgentMembers: async () => {
    state.boardAgentCalls += 1;
    return agentRows;
  },
});
stubModule("src/utils/controllers/search/document.ts", {
  turbopufferFetchMentionTasks: async () => tasks,
});
stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => ({ userId: 6 }),
});

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const taskSearchModule = jiti(
  path.join(root, "src/utils/controllers/tasks/taskSearchByParam.ts"),
);
const taskSearchByParam =
  typeof taskSearchModule === "function"
    ? taskSearchModule
    : taskSearchModule.default;
const aiMentionModule = jiti(
  path.join(root, "src/pages/api/ai/chat/mention.ts"),
);
const aiMentionHandler =
  typeof aiMentionModule === "function"
    ? aiMentionModule
    : aiMentionModule.default;

function group(response, itemType) {
  return response.filter((item) => item.type === itemType);
}

function mockResponse() {
  const result = { statusCode: null, body: null };
  const res = {
    status(code) {
      result.statusCode = code;
      return res;
    },
    json(payload) {
      result.body = payload;
      return res;
    },
  };
  return { res, result };
}

test.beforeEach(() => {
  state.accessibleProjectIds = [339];
  state.boardAgentCalls = 0;
});

test("task mentions return every matching board agent in stable name order", async () => {
  const response = await taskSearchByParam("inne", 6, 339);

  assert.equal(response.status, 200);
  assert.deepEqual(
    group(response.json, "agent").map((item) => item.id),
    expectedAgentIds,
  );
  assert.equal(group(response.json, "name").length, 0);
  assert.equal(group(response.json, "project").length, 5);
});

test("task mention agent filtering is case-insensitive and keeps stable ties", async () => {
  const response = await taskSearchByParam("INNE Alpha", 6, 339);

  assert.equal(response.status, 200);
  assert.deepEqual(
    group(response.json, "agent").map((item) => item.id),
    ["a-1", "a-2"],
  );
});

test("task mentions reject a board outside the caller's accessible projects", async () => {
  state.accessibleProjectIds = [15];

  const response = await taskSearchByParam("all", 6, 339);

  assert.equal(response.status, 403);
  assert.deepEqual(response.json, []);
  assert.equal(state.boardAgentCalls, 0);
});

test("AI chat mentions return every board agent in the same stable order", async () => {
  const { res, result } = mockResponse();

  await aiMentionHandler(
    { method: "GET", query: { param: "all", projectId: "339" }, headers: {} },
    res,
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    group(result.body, "agent").map((item) => item.id),
    expectedAgentIds,
  );
  assert.equal(group(result.body, "name").length, 5);
  assert.equal(group(result.body, "project").length, 5);
  assert.equal(group(result.body, "task").length, 5);
});
