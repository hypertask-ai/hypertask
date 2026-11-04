const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const activityId = "1ed22030-be15-4a85-a534-cf9411e285fa";

const modules = [
  "@/lib/agents/publicAgent",
  "@/lib/agents/writing",
  "@/lib/agents/writingEnforcement",
  "@/lib/auth/agentScope",
  "@/lib/configs/general.config",
  "@/lib/media/inlineAgentImages.server",
  "@/lib/flags",
  "@/lib/flags/keys",
  "@/lib/mcp/agents",
  "@/lib/mcp/comments/contentPresence",
  "@/lib/mcp/comments/visibleReactionAgents",
  "@/lib/mcp/normalizeBlockHtml",
  "@/lib/mcp/operationCrashReport",
  "@/lib/mcp/tasks/services",
  "@/lib/mcp/tasks/validators",
  "@/lib/realtime/server",
  "@/utils/controllers/comments/deleteCommentService",
  "@/utils/controllers/comments/processMentions",
  "@/utils/controllers/comments/resolveMentionInputs",
  "@/utils/controllers/comments/updateCommentService",
  "@/utils/controllers/tasks/assertTaskAccess",
  "@/utils/controllers/urls/extractUrlsFromContent",
  "@/utils/helperFunctions/markdownToHtml",
  "@/utils/helperFunctions/multiPages",
  "@/utils/helperFunctions/sanitizeRichHtml",
];

function route(id, { method = "PATCH", text = "Edited text" } = {}) {
  const reads = [];
  const prisma = {
    comment: {
      findUnique: async (args) => {
        reads.push(args.where.id);
        return null;
      },
      update: async () => {
        throw new Error("a refused comment id must never write");
      },
      delete: async () => {
        throw new Error("a refused comment id must never write");
      },
    },
  };
  const stubs = { "@/lib/prisma": prisma };
  for (const specifier of modules) stubs[specifier] = {};
  Object.assign(stubs, {
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: null, teamScope: null }),
      checkMcpRouteRateLimit: async () => null,
    },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => null },
  });
  const operation = load("src/lib/mcp/operations/comments/[comment_id]/operation.ts", stubs);
  const request = new NextRequest(`http://localhost/api/mcp/comments/${id}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "PATCH" ? { body: JSON.stringify({ text }) } : {}),
  });
  return {
    call: () => operation[method](request, { params: Promise.resolve({ comment_id: id }) }),
    reads,
  };
}

for (const method of ["PATCH", "DELETE"]) {
  test(`${method} refuses an activity id instead of editing the comment its leading digits name`, async () => {
    const { call, reads } = route(activityId, { method });
    const response = await call();
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Invalid comment_id");
    assert.deepEqual(reads, []);
  });

  test(`${method} refuses leading digits followed by text instead of truncating them`, async () => {
    const { call, reads } = route("12abc", { method });
    assert.equal((await call()).status, 400);
    assert.deepEqual(reads, []);
  });

  test(`${method} refuses a zero, negative or fractional id`, async () => {
    for (const id of ["0", "-4", "1.5"]) {
      const { call, reads } = route(id, { method });
      assert.equal((await call()).status, 400, id);
      assert.deepEqual(reads, []);
    }
  });
}

test("a numeric comment id still reaches the comment lookup", async () => {
  const { call, reads } = route("42");
  const response = await call();
  assert.equal(response.status, 404);
  assert.deepEqual(reads, [42]);
});
