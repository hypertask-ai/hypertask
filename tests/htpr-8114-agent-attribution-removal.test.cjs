const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const { overlayDurableAgentDisplayName } = load("src/lib/agents/publicAgent.ts", {});

test("durable attribution always replaces stale names without exposing living private agents", () => {
  const cases = [
    [{ hasAgentRow: false, storedDisplayName: "Retired helper" }, "Retired helper"],
    [{ hasAgentRow: true, visibleAgent: null, storedDisplayName: "Secret helper" }, "Private agent"],
    [{ hasAgentRow: true, visibleAgent: { displayName: "New name" }, storedDisplayName: "Original name" }, "Original name"],
    [{ hasAgentRow: true, visibleAgent: { displayName: "Live helper" } }, "Live helper"],
    [{ hasAgentRow: false, storedDisplayName: "   " }, undefined],
  ];
  for (const [options, expected] of cases) {
    const input = { id: 1, text: "Unchanged", agent_display_name: "Stale name" };
    const result = overlayDurableAgentDisplayName(input, options);
    assert.equal(result.agent_display_name, expected);
    assert.equal(result.id, 1);
    assert.equal(result.text, "Unchanged");
    assert.equal(input.agent_display_name, "Stale name");
    assert.equal(Object.hasOwn(result, "agent_display_name"), expected !== undefined);
  }
});

test("the released flag is absent from the registry and its stored row has an exact deletion", () => {
  const { FEATURE_FLAG_DEFINITIONS } = require("./helpers/flag-files.cjs").load(
    path.join(root, "src/lib/flags/definitions.ts"),
  );
  assert.equal(FEATURE_FLAG_DEFINITIONS.some(({ key }) => key === "htpr-6516-agent-attribution"), false);
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions/htpr-6516-agent-attribution.ts")), false);
  assert.equal(fs.readFileSync(path.join(root,
    "src/prisma/migrations/20261028133000_drop_htpr_6516_agent_attribution_flag/migration.sql"), "utf8").trim(),
    'DELETE FROM "FeatureFlag" WHERE "key" = \'htpr-6516-agent-attribution\';');
});

test("AI task context returns permanent attribution through the tool executor", async () => {
  const comments = [
    { id: 1, text: "Retired", createdAt: new Date(0), agent: null, agentDisplayName: "Retired helper" },
    { id: 2, text: "Private", createdAt: new Date(0), agent: { id: "hidden", userId: 9, visibility: "PRIVATE", members: [] }, agentDisplayName: "Secret helper" },
    { id: 3, text: "Shared", createdAt: new Date(0), agent: { id: "shared", userId: 6, displayName: "Shared helper" }, agentDisplayName: "Shared helper" },
  ];
  const { createTaskContextTool } = load("src/lib/ai/tools/taskContext.ts", {
    ai: { tool: (definition) => definition },
    "@/lib/prisma": { default: {
      task: { findFirst: async () => ({}) },
      comment: { count: async () => 3, findMany: async ({ select }) => select.id ? [...comments] : [] },
      taskRelations: { findMany: async () => [] },
    } },
    "@/lib/mcp/tasks/resolveTask": { findTaskByIdentifier: async () => ({ id: 42, projectId: 15 }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/mcp/tasks/mappers": { taskMcpGetInclude: () => ({}) },
    "@/lib/mcp/tasks/extractPrLinks": { extractPrLinks: () => [] },
    "@/lib/ai/tools/execution": { withToolErrors: (execute) => execute },
    "@/lib/ai/tools/helpers": {
      mapTaskToMcpGetResponse: () => ({ id: 42 }),
      stripInlineDataUris: (text) => text,
      sanitizeForJson: (value) => value,
    },
  });
  const { hypertask_task_context } = createTaskContextTool({ user: { id: 6 }, sendStatus() {} });
  const result = await hypertask_task_context.execute({ task_id: 42, project_id: 15, summary: false });
  assert.equal(result.success, true);
  assert.deepEqual(result.comments.map(({ author }) => author), ["Shared helper", "Private agent", "Retired helper"]);
  assert.equal(result.commentCount, 3);
  assert.equal(result.truncated, false);
});
