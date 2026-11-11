const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture } = require("./helpers/agent-board-scope.cjs");

for (const [actor, taskId, status] of [
  ["an agent outside the board", 21280, 404],
  ["an agent on the board", 40600, 200],
  ["the board owner", 21280, 200],
]) {
  test(`description history for ${actor} returns ${status}`, async () => {
    const f = fixture();
    if (actor === "the board owner") f.state.ctx.agentId = null;
    f.prisma.docVersion = {
      findMany: async () => [{
        id: 1,
        version: 1,
        contentHtml: "<p>Hello</p>",
        authorId: f.user.id,
        agentId: null,
        note: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      }],
    };
    const { GET } = f.load("src/lib/mcp/operations/tasks/description-versions/operation.ts", {
      "@/utils/controllers/pages/htmlToMarkdown": { htmlToMarkdown: (html) => html },
      "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    });
    const response = await GET(new NextRequest(`https://app.hypertask.ai/api/mcp/tasks/description-versions?task_id=${taskId}`));
    assert.equal(response.status, status);
    const body = await response.json();
    if (status === 404) assert.equal(body.error, "Task not found");
    else {
      assert.equal(body.versions.length, 1);
      assert.equal(body.versions[0].content, "<p>Hello</p>");
    }
  });
}

for (const operation of ["custom-fields/value", "tasks/description-restore"]) {
  for (const [actor, taskId, status] of [
    ["outsider", 21280, 404], ["member", 40600, 200], ["owner", 21280, 200],
  ]) {
    test(`${operation} ${actor} returns ${status} and only authorized writes persist`, async () => {
      const f = fixture();
      if (actor === "owner") f.state.ctx.agentId = null;
      f.state.ctx.agentRole = "write";
      const writes = [];
      f.prisma.docVersion = { findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: 1, entityType: "task_description", entityId: taskId });
        return { contentHtml: "<p>Restored</p>", version: 1 };
      } };
      const { POST } = f.load(`src/lib/mcp/operations/${operation}/operation.ts`, {
        "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
        "@/utils/controllers/description/common-description-create": { default: async (data) => { writes.push(data); } },
        "@/utils/controllers/customFields": {
          CustomFieldValidationError: class extends Error {},
          getCustomFieldForProjectById: async (projectId, id) => {
            assert.equal(projectId, taskId / 10);
            return { id, name: "Size", type: "Number" };
          },
          upsertCustomFieldValue: async (...args) => { writes.push(args); return { value: args[2] }; },
        },
      });
      const response = await POST(new NextRequest(`https://app.hypertask.ai/api/mcp/${operation}`, {
        method: "POST", body: JSON.stringify({ task_id: taskId, version_id: 1, field_id: "size", value: 5 }),
      }));
      assert.equal(response.status, status);
      const body = await response.json();
      if (status === 404) {
        assert.equal(body.error, "Task not found");
        assert.deepEqual(writes, []);
      } else if (operation === "custom-fields/value") {
        assert.equal(body.success, true);
        assert.deepEqual(writes, [["size", taskId, "5"]]);
        assert.deepEqual(body.customFieldValue, { value: "5" });
      } else {
        assert.deepEqual(body, { ok: true, restored_from_version: 1 });
        assert.deepEqual(writes, [{ taskId, creatorId: f.user.id, content: "<p>Restored</p>",
          agentId: f.state.ctx.agentId, teamScope: null, actingUserId: f.user.id }]);
      }
    });
  }
}
