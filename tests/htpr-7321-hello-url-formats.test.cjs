const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadHello(projects) {
  stubModule("src/lib/prisma.ts", { default: { project: { findMany: async () => projects } } });
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => false });
  stubModule("src/lib/mcp/auth.ts", {
    checkMcpRateLimit: async () => null,
    createUnauthorizedResponse: () => null,
    validateMcpAuth: async () => null,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", { getProjectListingWhere: () => ({}) });
  delete require.cache[path.join(root, "src/lib/mcp/hello/getHelloPayload.ts")];
  const jiti = createJiti(path.join(root, "tests/htpr-7321-hello-loader.cjs"), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  return jiti(path.join(root, "src/lib/mcp/hello/getHelloPayload.ts"));
}

const ctx = { user: { id: 985, displayName: "QA", email: "qa@example.test" }, agentId: "agent-runner-1" };
const board = { id: 4060, name: "agents", title: "Agents & Infra", playbook: null, ai_custom_instructions: [] };

test("hello teaches agents every app URL format with the ticket-number rule", async () => {
  const mod = loadHello([board]);
  const { urlFormats } = await mod.getHelloPayload(ctx);
  assert.equal(urlFormats.ticket, "https://app.hypertask.ai/detail/project-{boardId}/{taskNumber}");
  assert.equal(urlFormats.comment, "https://app.hypertask.ai/detail/project-{boardId}/{taskNumber}#comment-{commentId}");
  assert.equal(urlFormats.board, "https://app.hypertask.ai/project?id={boardId}");
  assert.equal(urlFormats.boardView, "https://app.hypertask.ai/project?id={boardId}&view={viewSlug}");
  assert.equal(urlFormats.inboxSplit, "https://app.hypertask.ai/inbox?split={splitName}&projectId={boardId}");
  assert.equal(urlFormats.page, "https://app.hypertask.ai/page/{pagePublicId}");
  assert.match(urlFormats.rules, /HTPR-7321 is 7321/);
  assert.match(urlFormats.rules, /never the global task id/);
});

test("each board keeps its ticket template and gains its own board link", async () => {
  const mod = loadHello([board]);
  const { boards } = await mod.getHelloPayload(ctx);
  assert.deepEqual(boards, [{
    id: 4060,
    name: "agents",
    title: "Agents & Infra",
    boardUrl: "https://app.hypertask.ai/project?id=4060",
    taskUrlTemplate: "https://app.hypertask.ai/detail/project-4060/{taskNumber}",
  }]);
});
