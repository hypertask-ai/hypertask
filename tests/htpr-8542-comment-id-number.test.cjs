const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const numericId = "1ed22030-be15-4a85-a534-cf9411e285fa";

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
  const stubs = {
    "@/lib/prisma": prisma,
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: null, teamScope: null }),
      checkMcpRouteRateLimit: async () => null,
    },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => null },
    "@/lib/agents/writingEnforcement": { enforceAgentWriting: async () => ({ ok: true }) },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/realtime/server": { broadcastTaskComment: async () => {} },
    "@/utils/controllers/FCM": { sendDataNewCommentFCM: async () => {}, sendDataOnlyFcm: async () => {} },
    "@/utils/controllers/comments/updateCommentService": { updateCommentService: async () => ({}) },
    "@/utils/controllers/comments/deleteCommentService": { deleteCommentService: async () => ({}) },
  };
  const operation = load("src/lib/mcp/operations/comments/[comment_id]/operation.ts", stubs);
  const request = new NextRequest(`http://localhost/api/mcp/comments/${id}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "PATCH" ? { body: JSON.stringify({ text }) } : {}),
  });
  return { call: () => operation[method](request, { params: Promise.resolve({ comment_id: id }) }), reads };
}

for (const method of ["PATCH", "DELETE"]) {
  test(`${method} refuses an activity id instead of editing the comment its leading digits name`, async () => {
    const { call, reads } = route(numericId, { method });
    const response = await call();
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid comment_id");
    assert.deepEqual(reads, []);
  });

  test(`${method} refuses leading digits followed by text instead of truncating them`, async () => {
    const { call, reads } = route("12abc", { method });
    const response = await call();
    assert.equal(response.status, 400);
    assert.deepEqual(reads, []);
  });

  test(`${method} refuses a zero or negative id`, async () => {
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
