const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture } = require("./helpers/agent-board-scope.cjs");

function harness(actor) {
  const f = fixture();
  f.state.enforce = true;
  if (actor === "owner") f.state.ctx.agentId = null;
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
  const route = f.load("src/lib/mcp/operations/tasks/description-versions/operation.ts", {
    "@/utils/controllers/pages/htmlToMarkdown": { htmlToMarkdown: (html) => html },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
  });
  return { route };
}

async function readVersions(route, taskId) {
  const request = new NextRequest(`https://app.hypertask.ai/api/mcp/tasks/description-versions?task_id=${taskId}`);
  return route.GET(request);
}

test("an agent who is not on the board cannot read description history", async () => {
  const { route } = harness("agent");
  const response = await readVersions(route, 21280);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, "Task not found");
});

test("an agent who is on the board can still read description history", async () => {
  const { route } = harness("agent");
  const response = await readVersions(route, 40600);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.versions.length, 1);
  assert.equal(body.versions[0].content, "<p>Hello</p>");
});

test("the board owner can still read description history", async () => {
  const { route } = harness("owner");
  const response = await readVersions(route, 21280);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.versions.length, 1);
});
