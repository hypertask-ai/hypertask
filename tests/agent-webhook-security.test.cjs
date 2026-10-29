const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("./refactored-module-source.cjs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("agent webhook owner routes require verified identity and selected-cookie origin", async () => {
  const { load } = require("./task-route-loader.cjs");
  const { NextRequest } = require("next/server");
  let session = { userId: 6, source: "legacy" };
  const calls = [];
  const route = load("src/app/api/agents/[agentId]/webhook/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => session },
    "@/lib/agentWebhooks/management": {
      AgentWebhookInputError: class extends Error {},
      upsertAgentWebhook: async input => { calls.push(input); return { success: true }; },
      manageAgentWebhook: async input => { calls.push(input); return { success: true }; },
    },
  });
  const invoke = (method, origin) => route[method](new NextRequest("https://app.example.test/api/agents/fixture/webhook", {
    method, headers: { host: "app.example.test", ...(origin ? { origin } : {}) },
    ...(method === "DELETE" ? {} : { body: JSON.stringify({ action: "test" }) }),
  }), { params: Promise.resolve({ agentId: "fixture" }) });
  for (const method of ["PUT", "POST", "DELETE"]) {
    assert.equal((await invoke(method)).status, 403);
    assert.equal((await invoke(method, "https://foreign.example.test")).status, 403);
    assert.equal((await invoke(method, "https://app.example.test")).status, method === "POST" ? 202 : 200);
    assert.equal(calls.at(-1).userId, 6);
    session = { userId: 6, source: "cli-bearer" };
    assert.equal((await invoke(method)).status, method === "POST" ? 202 : 200);
    session = null;
    assert.equal((await invoke(method, "https://app.example.test")).status, 401);
    session = { userId: 6, source: "legacy" };
  }
});

test("mention and assignment outbox rows share their domain transactions", () => {
  const comments = read("src/utils/controllers/comments/persistComment.ts");
  const assignments = read("src/utils/controllers/assignees/assign.ts");
  const updates = read("src/utils/controllers/tasks/single.ts");
  const creates = read("src/utils/controllers/tasks/createTaskCore.ts");
  const createRoute = read("src/utils/controllers/tasks/create.ts");
  const globalCreate = read("src/lib/api/task-writes/create-global.ts");
  const globalCreateEffects = read("src/lib/api/task-writes/create-global-effects.ts");
  const taskEvents = read("src/lib/mcp/webhooks/taskEvents.ts");
  const recovery = read("src/lib/agentWebhooks/taskCreatedRecovery.ts");
  const sweep = read("src/pages/api/queues/sweep.ts");
  const labelClassifier = read("src/lib/ai/labelClassifier.ts");
  const assignLabel = read("src/pages/api/labels/assignLabel.ts");
  const createLabel = read("src/pages/api/labels/createLabel.ts");
  const outbox = read("src/lib/agentWebhooks/outbox.ts");

  assert.match(comments, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(comments, /tx\.comment\.create/);
  assert.match(
    comments,
    /SELECT "id"[\s\S]*?FROM "Task"[\s\S]*?FOR UPDATE[\s\S]*?const currentTask = await tx\.task\.findFirst/,
  );
  assert.match(
    comments,
    /persistAgentWebhookEvents\(tx,[\s\S]*?event: "comment\.created"[\s\S]*?projectId: currentTask\.projectId/,
  );
  const commentWebhookSource = comments.slice(
    comments.indexOf("const commentCreatedEvent"),
    comments.indexOf("return {", comments.indexOf("const commentCreatedEvent")),
  );
  assert.doesNotMatch(commentWebhookSource, /projectId:\s*task\.projectId/);
  assert.match(comments, /persistAgentRunTriggerWebhooks\(tx,/);
  assert.match(
    comments,
    /for \(const mentionedAgentId of mentionedAgentIds\) \{\s*if \(\s*mentionedAgentId === agentId \|\|\s*mentionedAgentId === agentRunSelection\?\.agentId\s*\) \{\s*continue;\s*\}\s*webhookDeliveryIds\.push\(\s*\.\.\.\(await persistAgentRunTriggerWebhooks\(tx,/,
  );

  assert.match(assignments, /tx\.assignees\.create/);
  assert.match(assignments, /tx\.assignees\.deleteMany/);
  assert.equal(
    (assignments.match(/persistAgentRunTriggerWebhooks\(tx,/g) ?? []).length,
    1,
  );
  assert.equal(
    (assignments.match(/persistAgentWebhookEvent\(tx,/g) ?? []).length,
    2,
  );

  assert.match(
    updates,
    /prisma\.\$transaction\([\s\S]*?persistAgentTaskUpdatedWebhook\(tx,/,
  );
  assert.match(updates, /agentWebhookDeliveryIds/);
  assert.match(
    taskEvents,
    /db\.\$transaction\(async \(tx\) =>[\s\S]*?persistTaskCreatedWebhook\([\s\S]*?tx,/,
  );
  assert.match(
    creates,
    /writeTask\([\s\S]*?async \(tx\) =>[\s\S]*?persistAgentTaskCreatedPending\(tx,[\s\S]*?return \{ taskId:/,
  );
  assert.match(creates, /createTaskCoreWithWriter\(options, createTaskWithBoardWebhookOutbox\)/);
  assert.match(creates, /createTaskCoreWithWriter\(options, createProvisionedTaskWithBoardWebhookOutbox\)/);
  assert.match(
    createRoute,
    /createTaskWithBoardWebhookOutbox\([\s\S]*?async \(tx\) =>[\s\S]*?persistAgentTaskCreatedPending\(tx,[\s\S]*?return \{ taskId:/,
  );
  assert.match(
    globalCreate,
    /createTaskWithBoardWebhookOutbox\([\s\S]*?async \(tx\) =>[\s\S]*?persistAgentTaskCreatedPending\(tx,[\s\S]*?return \{[\s\S]*?taskId:/,
  );
  assert.match(outbox, /agentTaskCreatedPendingAt[\s\S]*?agentTaskCreatedReadyAt/);
  assert.match(
    creates,
    /markAgentTaskCreatedReady\(newTask\.id\)[\s\S]*?emitAgentTaskCreatedWebhook/,
  );
  assert.match(
    createRoute,
    /markAgentTaskCreatedReady\(task\.id\)[\s\S]*?emitAgentTaskCreatedWebhook/,
  );
  assert.match(
    globalCreateEffects,
    /markAgentTaskCreatedReady\(task\.id\)[\s\S]*?emitAgentTaskCreatedWebhook/,
  );
  assert.match(
    recovery,
    /agentTaskCreatedReadyAt[\s\S]*?markAgentTaskCreatedReady\(taskId\)/,
  );
  const globalLabels = globalCreate.indexOf("tx.taskLabel.createMany");
  const globalAssignees = globalCreate.indexOf("await persistAssignee(");
  const globalPending = globalCreate.indexOf("persistAgentTaskCreatedPending(tx");
  assert.ok(globalLabels > 0 && globalLabels < globalPending);
  assert.ok(globalAssignees > 0 && globalAssignees < globalPending);
  assert.match(creates, /autoAssignForSection[\s\S]*?emitAgentTaskCreatedWebhook\(/);
  assert.match(recovery, /autoAssignForSection[\s\S]*?emitAgentTaskCreatedWebhook\(/);
  assert.match(sweep, /sweepPendingAgentTaskCreatedWebhooks/);
  assert.match(
    assignLabel,
    /prisma\.\$transaction\(async \(tx\) =>[\s\S]*?tx\.taskLabel\.create[\s\S]*?persistAgentTaskUpdatedWebhook\(tx,/,
  );
  assert.match(
    createLabel,
    /prisma\.\$transaction\(async \(tx\) =>[\s\S]*?tx\.label\.create[\s\S]*?persistAgentTaskUpdatedWebhook\(tx,/,
  );
  assert.match(
    labelClassifier,
    /WHERE "id" = \$\{taskId\}[\s\S]*?AND "projectId" = \$\{projectId\}[\s\S]*?FOR UPDATE[\s\S]*?tx\.taskLabel\.upsert/,
  );

  assert.match(outbox, /tx\.agentWebhookDelivery\.create/);
  assert.match(outbox, /agent: \{[\s\S]*members: \{ some: \{ projectId/);
  assert.match(outbox, /agentTaskCreatedPendingAt/);
  assert.match(outbox, /agentTaskCreatedEmittedAt/);
  assert.match(outbox, /FOR UPDATE/);
  assert.match(outbox, /persistAgentWebhookEvents\(tx,[\s\S]*?agentTaskCreatedEmittedAt/);
  assert.match(outbox, /publishAgentWebhookDeliveries[\s\S]*queueAgentWebhookDelivery\(deliveryId\)\.catch/);
});

test("agent endpoints require HTTPS and deleted board filters cannot widen", () => {
  const management = read("src/lib/agentWebhooks/management.ts");
  const schema = read("src/prisma/schema.prisma");
  const migration = read(
    "src/prisma/migrations/20260813123000_add_agent_webhook_outbox/migration.sql",
  );

  assert.match(management, /new URL\(requestedUrl\)\.protocol !== "https:"/);
  assert.match(management, /url must use HTTPS/);
  assert.match(
    schema,
    /project\s+Project\?\s+@relation\(fields: \[projectId\], references: \[id\], onDelete: Cascade\)/,
  );
  assert.match(
    migration,
    /"projectId"\) REFERENCES "Project"\("id"\) ON DELETE CASCADE/,
  );
});
