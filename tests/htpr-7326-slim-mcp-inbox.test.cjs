const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");
const flagFiles = require("./helpers/flag-files.cjs");

const slimFlag = "htpr-7326-slim-mcp-inbox";

function inboxController() {
  const calls = { flags: [], queries: [] };
  const prisma = {
    $queryRaw: async () => [{ id: 42 }],
    notification: { findMany: async (args) => {
      calls.queries.push(args);
      return [];
    } },
    task: { findMany: async () => [] },
    userSetting: { findUnique: async () => null },
  };
  const controller = load("src/utils/controllers/notifications/getAll.ts", {
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": {

      isFeatureEnabled: async (key, userId) => {
        calls.flags.push([key, userId]);
        throw new Error("Inbox must not read a feature flag");
      },
    },
    "@/utils/helperFunctions/helperFunctions": { getInboxTabs: () => ({}) },
    "@/utils/controllers/notifications/quietOwnerInbox": { markQuietAgentMentions: async (_client, _userId, rows) => rows },
  });
  return { controller, prisma, calls };
}

for (const options of [undefined, {}, { withCachedDescription: true }, { withCachedDescription: false }]) {
  test(`real inbox controller preserves cached descriptions unless explicitly disabled: ${JSON.stringify(options)}`, async () => {
    const { controller, prisma, calls } = inboxController();
    assert.deepEqual(await controller.getInboxNotifications(985, prisma, options), []);
    const enabled = options?.withCachedDescription !== false;
    assert.deepEqual(calls.flags, []);
    assert.equal(calls.queries.length, 1);
    const query = calls.queries[0];
    assert.equal(Object.hasOwn(query.include.task.select, "description_"), enabled);
    if (enabled) assert.deepEqual(query.include.task.select.description_, { select: { content: true } });
    assert.equal(query.include.task.select.title, true);
    assert.equal(query.where.AND[1].userId, 985);
    assert.deepEqual(query.where.AND[0], { id: { in: [42] } });
  });
}

test("notificationGetAll forwards the cached-description option to the real inbox query", async () => {
  for (const options of [undefined, { withCachedDescription: false }]) {
    const { controller, calls } = inboxController();
    const result = await controller.default("985", options);
    assert.equal(result.status, 200);
    assert.deepEqual(calls.flags, []);
    assert.equal(Object.hasOwn(calls.queries.find((query) => query.include).include.task.select, "description_"), !options);
  }
});

for (const agentId of [null, "agent-1"]) {
  for (const state of [true, false, "error"]) {
    test(`MCP ${agentId ? "agent" : "user"} inbox uses one slim flag lookup and preserves fallback: ${state}`, async () => {
      const flagCalls = [];
      const inboxCalls = [];
      const { GET } = load("src/lib/mcp/operations/inbox/list/operation.ts", {
        "@/lib/mcp/routeWrapper": {
          wrapMcpRoute: (handler) => handler,
          checkMcpRouteRateLimit: async () => null,
          validateMcpRouteAuth: async () => ({ user: { id: 985, email: "qa@example.test" }, agentId }),
        },
        "@/lib/mcp/auth": { createUnauthorizedResponse: () => { throw new Error("unexpected unauthorized request"); } },
        "@/lib/mcp/agents": {},
        "@/lib/prisma": { default: {} },
        "@/lib/flags": {
          HTPR_7326_SLIM_MCP_INBOX_FLAG: slimFlag,
          isFeatureEnabled: async (key, userId) => {
            flagCalls.push([key, userId]);
            if (state === "error") throw new Error("flag unavailable");
            return state;
          },
        },
        "@/utils/controllers/notifications/getAll": { default: async (...args) => {
          inboxCalls.push(args);
          return { status: 200, json: { structuredData: {}, notifications: [] } };
        } },
        "@/utils/controllers/notifications/getStructuredInboxForAgent": {
          getStructuredInboxForAgent: async () => ({ ok: true, structuredData: {}, notifications: [] }),
        },
      });
      const response = await GET(new NextRequest("https://app.hypertask.ai/api/mcp/inbox/list"));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).success, true);
      assert.deepEqual(flagCalls, [[slimFlag, 985]]);
      assert.deepEqual(inboxCalls, [["985", { withCachedDescription: state !== true }, ...(agentId ? [agentId] : [])]]);
    });
  }
}

test("slim inbox flag is a registered small-risk Everyone bugfix", () => {
  const definition = flagFiles.definitions().find((entry) => entry.key === slimFlag);
  assert.ok(definition);
  assert.equal(flagFiles.load("src/lib/flags/keys.ts").HTPR_7326_SLIM_MCP_INBOX_FLAG, slimFlag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-18");
  assert.equal(definition.description, "Leaves full task descriptions out of the CLI and MCP inbox list so it downloads about a third less.");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});
