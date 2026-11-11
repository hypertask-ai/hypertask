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
