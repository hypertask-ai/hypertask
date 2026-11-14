const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

class AttachmentBatchError extends Error {
  constructor(message, status, cleanupConfirmed, attachments = [], failedFiles = []) {
    super(message);
    this.name = "AttachmentBatchError";
    this.status = status;
    this.cleanupConfirmed = cleanupConfirmed;
    this.attachments = attachments;
    this.failedFiles = failedFiles;
  }
}

function setup() {
  const state = { failure: null, crashes: [], broadcasts: [] };
  const operation = load("src/lib/mcp/operations/tasks/attachments/operation.ts", {
    "next/server": {
      NextRequest: class {},
      NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    },
    "@/lib/planLimits": {
      assertUploadAllowedForProject: async () => {},
      isPlanLimitsEnabled: async () => false,
      isPlanLimitReachedError: () => false,
      planLimitResponse: () => ({ body: { success: false }, status: 400 }),
    },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/mcp/auth": { validateMcpAuth: async () => ({ user: { id: 985 }, teamScope: null }), checkMcpRateLimit: async () => null },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (handler) => handler },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (_request, error) => state.crashes.push(error) },
    "@/lib/prisma": {
      default: {
        attachment: { findFirst: async () => null },
        description: { findUnique: async () => ({ id: "description-1" }) },
        comment: { findFirst: async () => null },
      },
    },
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/tasks/resolveTask": {
      findTaskByIdentifier: async () => ({ id: 1, projectId: 15 }),
      taskIdentifierErrorResponse: () => null,
    },
    "@/lib/mcp/attachments/storeBatch": { AttachmentBatchError },
    "@/lib/mcp/attachments/storeLockedBatch": {
      storeAttachmentBatchWithTargetLock: async () => {
        throw state.failure;
      },
    },
    "@/lib/mcp/attachments/downloadHandler": { createAttachmentDownloadHandler: () => async () => new Response(null) },
    "@/lib/realtime/server": {
      broadcastTaskChange: (taskId) => state.broadcasts.push(["task", taskId]),
      broadcastTaskComment: (taskId) => state.broadcasts.push(["comment", taskId]),
    },
  });
  return { state, POST: operation.POST };
}

function request() {
  return new Request("https://app.hypertask.ai/api/mcp/tasks/attachments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      unique_index: 9278,
      project_id: 15,
      files: [{ filename: "page.png", content_type: "image/png", url: "https://example.com/page" }],
    }),
  });
}

async function call() {
  const warnings = [];
  const errors = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...args) => warnings.push(args);
  console.error = (...args) => errors.push(args);
  try {
    const { state, POST } = setup();
    state.failure = setup.failure;
    const response = await POST(request());
    return { state, response, warnings, errors };
  } finally {
    console.warn = original.warn;
    console.error = original.error;
  }
}

test("a URL that returns a web page is logged as a caller warning, never a production error (HTPR-9278)", async () => {
  const failure = new AttachmentBatchError(
    "Unsupported Content-Type from URL: text/html",
    400,
    true,
    [],
    [{ index: 0, filename: "page.png", error: "Unsupported Content-Type from URL: text/html" }]
  );
  setup.failure = failure;
  const { state, response, warnings, errors } = await call();
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error, "Unsupported Content-Type from URL: text/html");
  assert.equal(response.body.failed_files.length, 1);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "[MCP attachments] caller error");
  assert.deepEqual(warnings[0][1], {
    status: 400,
    error: "Unsupported Content-Type from URL: text/html",
  });
  assert.deepEqual(state.crashes, []);
  assert.deepEqual(state.broadcasts, []);
});

test("every caller mistake stays out of the error stream", async () => {
  for (const status of [400, 404, 409]) {
    setup.failure = new AttachmentBatchError("Task not found or access denied", status, true);
    const { warnings, errors } = await call();
    assert.deepEqual(errors, [], String(status));
    assert.equal(warnings.length, 1, String(status));
    assert.equal(warnings[0][1].status, status);
  }
});

test("a server failure still logs and reports as an error", async () => {
  setup.failure = new AttachmentBatchError("Failed to store attachment(s)", 500, false);
  const { state, response, warnings, errors } = await call();
  assert.equal(response.status, 500);
  assert.deepEqual(warnings, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "[MCP attachments]");
  assert.equal(state.crashes.length, 1);
});

test("an unexpected throw is still a server error", async () => {
  setup.failure = new Error("database down");
  const { state, response, warnings, errors } = await call();
  assert.equal(response.status, 500);
  assert.deepEqual(warnings, []);
  assert.equal(errors.length, 1);
  assert.equal(state.crashes.length, 1);
});
