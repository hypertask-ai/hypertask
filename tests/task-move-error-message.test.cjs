// HTPR-5478: the CLI printed "Failed to update 1 task(s). [object Object]"
// whenever a hop dropped an error object into a string slot. Two halves:
// every relay unwraps the payload, and no controller hands back a raw Error.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function compile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
}

function execute(javascript, stubs) {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const { toErrorMessage } = execute(compile("src/lib/api/errorMessage.ts"), {});

test("toErrorMessage unwraps nested API error payloads to a printable string", () => {
  assert.equal(toErrorMessage("plain text", "fallback"), "plain text");
  assert.equal(
    toErrorMessage({ message: "Caller holds no agent mutation lease" }, "fb"),
    "Caller holds no agent mutation lease",
  );
  assert.equal(
    toErrorMessage({ message: { message: "double wrapped" } }, "fb"),
    "double wrapped",
  );
  assert.equal(
    toErrorMessage({ error: "route style payload" }, "fb"),
    "route style payload",
  );
  assert.equal(
    toErrorMessage({ message: { error: { detail: "nested hop" } } }, "fb"),
    "nested hop",
  );
  assert.equal(toErrorMessage(new Error("thrown"), "fb"), "thrown");
  assert.equal(toErrorMessage({}, "fallback"), "fallback");
  assert.equal(toErrorMessage(null, "fallback"), "fallback");
  assert.equal(toErrorMessage({ message: "   " }, "fallback"), "fallback");
  // A cycle must not hang the relay that is trying to report a failure.
  const cyclic = { message: {} };
  cyclic.message.message = cyclic;
  assert.equal(toErrorMessage(cyclic, "fallback"), "fallback");
});

test("a nested move payload no longer reaches the caller as [object Object]", () => {
  const nested = {
    message: { message: "Caller holds no agent mutation lease for this task." },
  };
  // What the MCP relay used to do: `new Error(errorData.message)`.
  assert.match(
    `Failed to update 1 task(s). ${new Error(nested.message).message}`,
    /\[object Object\]/,
  );

  const fixed = `Failed to update 1 task(s). ${toErrorMessage(nested, "Move task failed")}`;
  assert.equal(
    fixed,
    "Failed to update 1 task(s). Caller holds no agent mutation lease for this task.",
  );
  assert.doesNotMatch(fixed, /\[object Object\]/);
});

// The delete route hands `response.json` straight to the client, so a raw
// Error there serialised to `{"message":{}}` and printed "[object Object]".
function loadDeleteController(deleteOutcome) {
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: {} },
    "@/models/ActivityModels.ts": {},
    "@/models/model": {},
    "@prisma/client": { Status: { Archive: "Archive" } },
    "../activities/createActivity": () => undefined,
    "../activities/createTaskMovedActivity": {
      createTaskMovedActivityInTransaction: () => undefined,
    },
    "../activities/sendTaskMoveNotification": {
      sendTaskMoveNotificationIfNeeded: () => undefined,
    },
    "../notifications/creation-service/createAndSendNotificationTaskMove": () =>
      undefined,
    "../description/common-description-create": () => undefined,
    "@/pages/api/queues/FAST/generateSummary": () => undefined,
    "../turbopuffer/turbopufferHelper": {
      upsertAllCommentsToTurbopuffer: () => undefined,
      upsertTaskToTurbopuffer: () => undefined,
    },
    "../assignees/autoAssignForSection": {
      autoAssignForSection: () => undefined,
    },
    "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels: () => undefined },
    "./spawnRecurrence": {
      sectionIsDone: () => undefined,
      spawnNextRecurrence: () => undefined,
    },
    "@/utils/controllers/projects/getAllIncludes": {
      taskWriteAccessWhere: () => ({}),
    },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: () => undefined,
      cancelAgentMutationLeaseForHumanOverride: () => undefined,
    },
    "./invokeTaskDelete": { permanentlyDeleteTask: deleteOutcome },
    "@/lib/mcp/webhooks/outbox": {
      persistBoardWebhookEvent: async () => [],
      publishBoardWebhookDeliveries: () => undefined,
    },
    "@/lib/agentWebhooks/outbox": {
      persistAgentTaskUpdatedWebhook: async () => [],
      publishAgentWebhookDeliveries: () => undefined,
    },
    "@/lib/mcp/tasks/humanMutationOverride": {
      hasRequestedTaskStateChange: () => false,
      normalizeRequestedTaskMutation: (task) => task,
      requestedTaskStateChanges: (_task, mutation) => mutation,
      taskLifecycleTimestampChanges: () => ({}),
    },
    "@/lib/cycleService": {
      assertCycleAssignable: async () => undefined,
      CycleAssignmentError: class extends Error {},
    },
  };
  return execute(compile("src/utils/controllers/tasks/single.ts"), stubs);
}

test("a failed delete answers with printable text, not a serialised Error", async () => {
  const { deleteTaskSingle } = loadDeleteController(async () => {
    throw new Error(
      "Invalid `prisma.task.delete()` invocation: column tasks.secret_column",
    );
  });

  const result = await deleteTaskSingle(101, 6);

  assert.equal(result.status, 500);
  // What a client actually receives over the wire.
  const wireBody = JSON.parse(JSON.stringify(result.json));
  assert.equal(typeof wireBody.message, "string");
  assert.equal(`${wireBody.message}`, "Failed to delete task");
  assert.doesNotMatch(`${wireBody.message}`, /\[object Object\]/);
  // The internal Prisma detail belongs in the server log, not the response.
  assert.doesNotMatch(wireBody.message, /secret_column/);
});

test("a successful delete still answers with the deleted task id", async () => {
  const { deleteTaskSingle } = loadDeleteController(async () => "success");

  const result = await deleteTaskSingle(101, 6);

  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { id: 101 });
});
