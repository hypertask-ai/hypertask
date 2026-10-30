const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const mocks = {
  "@/utils/controllers/reports/reportService": { REPORT_CAPABILITIES: "Report capabilities" },
};

test("agent ticket sharing ships two MCP doors with annotations and summaries", () => {
  const { TOOL_METADATA, TOOL_NAMES } = load("src/lib/mcp-server/config/tool-metadata.ts", mocks);
  const { TOOL_SUMMARIES } = load("src/lib/mcp-server/config/tool-summaries.ts", mocks);
  const { TOOL_ANNOTATIONS } = load("src/lib/mcp-server/config/tool-annotations.ts", mocks);

  assert.equal(TOOL_METADATA.SHARE_TASK.name, "hypertask_share_task");
  assert.equal(TOOL_METADATA.GET_TASK_SHARE.name, "hypertask_get_task_share");
  assert.ok(TOOL_NAMES.includes("hypertask_share_task"));
  assert.ok(TOOL_NAMES.includes("hypertask_get_task_share"));

  assert.ok(TOOL_SUMMARIES.SHARE_TASK);
  assert.ok(TOOL_SUMMARIES.GET_TASK_SHARE);

  assert.equal(TOOL_ANNOTATIONS.hypertask_share_task.readOnlyHint, false);
  assert.equal(TOOL_ANNOTATIONS.hypertask_share_task.destructiveHint, false);
  assert.equal(TOOL_ANNOTATIONS.hypertask_get_task_share.readOnlyHint, true);
});

test("the share tools are registered and the share route serves both doors", () => {
  const { MCP_TOOLS } = load("src/lib/mcp-server/tools/index.ts", {
    ...mocks,
    "@/lib/mcp/decisionsGuidance": { DECISIONS_GUIDANCE: "" },
  });
  const names = MCP_TOOLS.map((tool) => tool.name);
  assert.ok(names.includes("hypertask_share_task"));
  assert.ok(names.includes("hypertask_get_task_share"));
  const tool = MCP_TOOLS.find((entry) => entry.name === "hypertask_get_task_share");
  assert.deepEqual(Object.keys(tool.parameters.shape), ["taskId"]);
});

test("ticket sharing has its own Everyone-default feature flag with a release risk", () => {
  const { default: definition, HTPR_8216_AGENT_TASK_SHARE_FLAG } = load(
    "src/lib/flags/definitions/htpr-8216-agent-task-share.ts",
    {},
  );
  assert.equal(HTPR_8216_AGENT_TASK_SHARE_FLAG, "htpr-8216-agent-task-share");
  assert.equal(definition.key, HTPR_8216_AGENT_TASK_SHARE_FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(definition.releaseRisk.highRisk, "access");
});
