const test = require("node:test");
const assert = require("node:assert/strict");
const { Prisma } = require("@prisma/client");
const { load } = require("./task-route-loader.cjs");

const acquisitionError = () => new Prisma.PrismaClientKnownRequestError(
  "Transaction API error: Unable to start a transaction in the given time.",
  { code: "P2028", clientVersion: "7.10.1" },
);

function fixture({ failures = [], scoped = false, callbackError, webhook = false, missingAgent = false } = {}) {
  const options = [], queries = [], scopeCalls = [];
  let deliveries = 0;
  const context = { user: { id: 7 }, agentId: "runner", ...(scoped ? { teamScope: { teamId: "team" } } : {}) };
  const tx = {
    $queryRaw: async (strings, ...values) => {
      queries.push({ sql: strings.join("?"), values });
      if (callbackError) throw callbackError;
      if (strings.join("").includes('FROM "Agent"')) return missingAgent ? [] : [{ id: "runner", userId: 7 }];
      if (deliveries++) return [];
      return [{ id: "message", sessionId: "session", text: "Hello", context: null, userName: "Sender" }];
    },
    agentWebhookSubscription: { findUnique: async () => ({ active: webhook }) },
    chatSession: { findMany: async () => [{ id: "session" }] },
  };
  const { GET } = load("src/app/api/mcp/chat/pending/route.ts", {
    "@/lib/prisma": { default: { $transaction: async (callback, config) => {
      options.push(config);
      const error = failures[options.length - 1];
      if (error) throw error;
      return callback(tx);
    } } },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => context,
    },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/agents/chatContentScope": { chatContentScopeWhere: async (value, client) => {
      scopeCalls.push(value);
      assert.equal(client, tx);
      return { teamId: "team" };
    } },
    "@/lib/agents/chatContext": { readableAgentChatContextIds: async () => new Set() },
  });
  return { options, queries, scopeCalls, poll: () => GET(new Request("https://app.hypertask.ai/api/mcp/chat/pending")) };
}

for (const scoped of [false, true]) {
  test(`pending recovers acquisition failure without replaying delivery, scoped=${scoped}`, async () => {
    const f = fixture({ failures: [acquisitionError()], scoped });
    const response = await f.poll();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).messages, [{ id: "message", sessionId: "session", text: "Hello", userName: "Sender" }]);
    assert.equal(f.options.length, 2);
    for (const config of f.options) {
      assert.equal(config.maxWait, 5000);
      assert.equal(config.isolationLevel, scoped ? "Serializable" : undefined);
    }
    assert.equal(f.queries.length, 2);
    assert.match(f.queries[1].sql, /FOR UPDATE OF message SKIP LOCKED/);
    if (scoped) {
      assert.equal(f.scopeCalls.length, 1);
      assert.deepEqual(f.scopeCalls[0], { userId: 7, agentId: "runner", teamScope: { teamId: "team" } });
      assert.ok(f.queries[1].values.some((value) => value?.strings?.join("").includes("session.id IN")));
    }
    assert.deepEqual((await (await f.poll()).json()).messages, []);
  });
}

test("pending retries acquisition only once and reports persistent failure", async () => {
  const f = fixture({ failures: [acquisitionError(), acquisitionError()] });
  assert.equal((await f.poll()).status, 500);
  assert.equal(f.options.length, 2);
  assert.equal(f.queries.length, 0);
});

test("pending never retries a transaction that already entered its callback", async () => {
  const f = fixture({ callbackError: acquisitionError() });
  assert.equal((await f.poll()).status, 500);
  assert.equal(f.options.length, 1);
  assert.equal(f.queries.length, 1);
});

test("pending does not retry unrelated acquisition errors", async () => {
  const f = fixture({ failures: [new Error("Connection refused")] });
  assert.equal((await f.poll()).status, 500);
  assert.equal(f.options.length, 1);
});

for (const [mode, status] of [["webhook", 200], ["missingAgent", 404]]) {
  test(`pending preserves ${mode} behavior after acquisition retry`, async () => {
    const f = fixture({ failures: [acquisitionError()], [mode]: true });
    const response = await f.poll();
    assert.equal(response.status, status);
    const body = await response.json();
    if (status === 200) assert.deepEqual(body.messages, []);
    else assert.equal(body.error, "Agent not found");
    assert.equal(f.queries.length, 1);
  });
}
