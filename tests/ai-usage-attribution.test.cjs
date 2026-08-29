const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("AiUsage stores indexed historical task and agent attribution", () => {
  const schema = read("src/prisma/schema.prisma");
  const migration = read(
    "src/prisma/migrations/20260810120000_add_ai_usage_task_agent_attribution/migration.sql",
  );
  const recorder = read("src/app/api/ai/_lib/aiUsage.ts");

  assert.match(schema, /model AiUsage[\s\S]*taskId\s+Int\?/);
  assert.match(schema, /model AiUsage[\s\S]*agentId\s+String\?/);
  assert.match(schema, /@@index\(\[taskId, createdAt\]\)/);
  assert.match(schema, /@@index\(\[agentId, createdAt\]\)/);
  assert.match(migration, /ADD COLUMN "taskId" INTEGER/);
  assert.match(migration, /ADD COLUMN "agentId" TEXT/);
  assert.match(recorder, /taskId\?: number \| null/);
  assert.match(recorder, /agentId\?: string \| null/);
});

test("ticket-scoped AI entry points pass their task attribution", () => {
  const expected = [
    ["src/app/api/ai/task-writer/route.ts", /taskId: usageTaskId/],
    ["src/app/api/mcp/ai/task-writer/route.ts", /taskId: usageTaskId/],
    ["src/app/api/ai/task-questions/route.ts", /taskId: task\.id/],
    ["src/app/api/ai/hyper-mentioned/route.ts", /taskId: usageTaskId/],
    ["src/app/api/ai/_lib/commentSummaries.ts", /taskId: comment\.task\.id/],
    ["src/lib/ai/labelClassifier.ts", /taskId: task\.id/],
    ["src/app/api/ai/chat/stream/route.ts", /taskId: contextTaskId/],
  ];

  for (const [file, pattern] of expected) {
    assert.match(read(file), pattern, `${file} must retain ticket attribution`);
  }
});

test("agent attribution survives MCP calls and summary debounce/retry", () => {
  assert.match(
    read("src/app/api/mcp/ai/task-writer/route.ts"),
    /agentId: ctx\.agentId/,
  );
  assert.match(
    read("src/app/api/mcp/ai/improve/route.ts"),
    /agentId: ctx\.agentId/,
  );

  const scheduler = read("src/pages/api/queues/FAST/generateSummary.ts");
  const worker = read("src/pages/api/queues/FAST/generateSummaryQueue.ts");
  const summaries = read("src/app/api/ai/_lib/taskSummaries.ts");
  assert.match(scheduler, /agentId\?: string \| null/);
  assert.match(
    scheduler,
    /body: agentId === undefined \? \{ taskId \} : \{ taskId, agentId \}/,
  );
  assert.match(worker, /agentId: job\.agentId/);
  assert.match(summaries, /scheduleSummaryRetry\(taskId, options\.agentId\)/);
  assert.match(
    summaries,
    /agentId: options\.agentId === undefined \? task\.agentId : options\.agentId/,
  );
  assert.match(summaries, /taskId: args\.taskId/);
  assert.match(summaries, /agentId: args\.agentId/);
});

test("usage reporting exposes ticket and agent breakdowns", () => {
  const settingsRoute = read("src/app/api/settings/ai-usage/route.ts");
  const settingsUi = read("src/components/Modals/Settings/AiUsageSection.tsx");
  const mcpRoute = read("src/app/api/mcp/ai/usage/route.ts");

  assert.match(settingsRoute, /by: \["taskId"\]/);
  assert.match(settingsRoute, /by: \["agentId"\]/);
  assert.match(settingsUi, /Most active tickets/);
  assert.match(settingsUi, /Most active agents/);
  assert.match(mcpRoute, /'task', 'agent'/);
  assert.match(mcpRoute, /task: 'taskId'/);
  assert.match(mcpRoute, /agent: 'agentId'/);
});

test("caller-supplied task attribution is project- and access-scoped", () => {
  const context = read("src/app/api/ai/_lib/currentTaskContext.ts");
  const taskWriter = read("src/app/api/ai/_lib/taskWriterRun.ts");
  const mcpImprove = read("src/app/api/mcp/ai/improve/route.ts");
  const editor = read("src/app/api/ai/tiptap-forwardslash/route.ts");
  const chat = read("src/app/api/ai/chat/stream/route.ts");
  const settings = read("src/app/api/settings/ai-usage/route.ts");

  assert.match(context, /projectId: Number\(args\.projectId\)/);
  assert.match(
    context,
    /project: projectContentAccessWhere\(args\.userId, args\.agentId\)/,
  );
  assert.match(taskWriter, /resolveAiUsageTaskId\(\{/);
  assert.match(mcpImprove, /Task not found in this project/);
  assert.match(editor, /Project not found or access denied/);
  assert.match(chat, /projectId: usageProjectId/);
  assert.match(settings, /project:\s*\{[\s\S]*teamId,/);
  assert.match(settings, /const breakdownProjectIds = isTeamOwner/);
  assert.match(settings, /projectId: \{ in: scopeProjectIds \}/);
  assert.match(settings, /loadAiUsageBreakdown\([\s\S]*breakdownProjectIds/);
  assert.match(settings, /const totalsByLabel = new Map<string, number>/);
  assert.match(settings, /totalsByLabel\.get\(row\.label\)/);
  assert.match(settings, /"Removed agent"/);
});
