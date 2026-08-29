const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/ai-bulk-confirmation-entry.cjs"), {
  interopDefault: true,
});
const { buildBulkOperationKey } = jiti(
  path.join(root, "src/app/api/ai/chat/stream/bulkTools.ts")
);

const helperSource = fs.readFileSync(
  path.join(root, "src/lib/ai/bulkConfirmation.ts"),
  "utf8"
);
const helperJavascript = ts.transpileModule(helperSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const helperModule = { exports: {} };
new Function("module", "exports", "require", helperJavascript)(
  helperModule,
  helperModule.exports,
  (request) => {
    if (request === "node:crypto") return require("node:crypto");
    if (request === "@/lib/redis") {
      return {
        getRedis: async () => {
          throw new Error("Tests must inject Redis");
        },
      };
    }
    throw new Error(`Unexpected import: ${request}`);
  }
);

const { requireCrossMessageConfirmation } = helperModule.exports;

class MemoryRedis {
  constructor() {
    this.tokens = new Map();
    this.setCalls = [];
  }

  async getdel(key) {
    const value = this.tokens.get(key) ?? null;
    this.tokens.delete(key);
    return value;
  }

  async set(key, value, expiryMode, ttlSeconds) {
    this.tokens.set(key, value);
    this.setCalls.push({ key, value, expiryMode, ttlSeconds });
    return "OK";
  }
}

function confirmationInput(redis, overrides = {}) {
  return {
    userId: 42,
    sessionId: "session-123",
    operationKey: buildBulkOperationKey(
      "update-tasks",
      [1, 2, 3, 4].map((taskId) => ({
        identifier: { task_id: taskId },
        resolvedTaskId: taskId,
      })),
      [["status", "Archive"]]
    ),
    confirmed: true,
    previewsIssuedThisRequest: new Set(),
    getRedisClient: async () => redis,
    ...overrides,
  };
}

function resolvedSubjects(identifiers, resolvedTaskIds) {
  return identifiers.map((identifier, index) => ({
    identifier,
    resolvedTaskId: resolvedTaskIds[index],
  }));
}

test("resolved task ids make ticket-number and task-id keys identical", () => {
  const taskIds = [501, 502, 503, 504, 505];
  const byTicketNumber = resolvedSubjects(
    taskIds.map((_, index) => ({
      ticket_number: `HTPR-${index + 1}`,
      project_id: 15,
    })),
    taskIds
  );
  const byTaskId = resolvedSubjects(
    taskIds.map((task_id) => ({ task_id })),
    taskIds
  );

  assert.equal(
    buildBulkOperationKey("task-assignees:assign", byTicketNumber, ["user:6"]),
    buildBulkOperationKey("task-assignees:assign", byTaskId, ["user:6"])
  );
});

test("resolved task order does not change the operation key", () => {
  const taskIds = [501, 502, 503, 504, 505];
  const subjects = resolvedSubjects(
    taskIds.map((task_id) => ({ task_id })),
    taskIds
  );

  assert.equal(
    buildBulkOperationKey("update-tasks", subjects, [["status", "Archive"]]),
    buildBulkOperationKey("update-tasks", [...subjects].reverse(), [
      ["status", "Archive"],
    ])
  );
});

test("a different resolved task set changes the operation key", () => {
  const first = [501, 502, 503, 504, 505];
  const second = [501, 502, 503, 504, 506];

  assert.notEqual(
    buildBulkOperationKey(
      "update-tasks",
      resolvedSubjects(first.map((task_id) => ({ task_id })), first),
      [["status", "Archive"]]
    ),
    buildBulkOperationKey(
      "update-tasks",
      resolvedSubjects(second.map((task_id) => ({ task_id })), second),
      [["status", "Archive"]]
    )
  );
});

test("changing an assignee or update field changes the operation key", () => {
  const taskIds = [501, 502, 503, 504, 505];
  const subjects = resolvedSubjects(
    taskIds.map((task_id) => ({ task_id })),
    taskIds
  );

  assert.notEqual(
    buildBulkOperationKey("task-assignees:assign", subjects, ["user:6"]),
    buildBulkOperationKey("task-assignees:assign", subjects, ["user:7"])
  );
  assert.notEqual(
    buildBulkOperationKey("update-tasks", subjects, [["status", "Archive"]]),
    buildBulkOperationKey("update-tasks", subjects, [["status", "Deleted"]])
  );
});

test("an unresolvable identifier remains part of the operation key", () => {
  const resolved = [501, 502, 503, 504].map((taskId) => ({
    identifier: { task_id: taskId },
    resolvedTaskId: taskId,
  }));
  const withMissingTask = [
    ...resolved,
    {
      identifier: { ticket_number: "HTPR-MISSING", project_id: 15 },
      resolvedTaskId: null,
    },
  ];

  assert.notEqual(
    buildBulkOperationKey("update-tasks", resolved, [["status", "Archive"]]),
    buildBulkOperationKey("update-tasks", withMissingTask, [
      ["status", "Archive"],
    ])
  );
  assert.notEqual(
    buildBulkOperationKey("update-tasks", withMissingTask, [
      ["status", "Archive"],
    ]),
    buildBulkOperationKey(
      "update-tasks",
      [
        ...resolved,
        {
          identifier: { ticket_number: "HTPR-OTHER", project_id: 15 },
          resolvedTaskId: null,
        },
      ],
      [["status", "Archive"]]
    )
  );
});

test("confirmed first call without a stored preview stays in preview", async () => {
  const redis = new MemoryRedis();
  const input = confirmationInput(redis);

  assert.equal(await requireCrossMessageConfirmation(input), "preview");
  assert.equal(redis.tokens.size, 1);
});

test("an unconfirmed call records a hashed, expiring preview token", async () => {
  const redis = new MemoryRedis();
  const input = confirmationInput(redis, { confirmed: false });

  assert.equal(await requireCrossMessageConfirmation(input), "preview");
  assert.equal(redis.setCalls.length, 1);
  assert.match(
    redis.setCalls[0].key,
    /^ai_bulk_confirm:42:session-123:[a-f0-9]{64}$/
  );
  assert.equal(redis.setCalls[0].key.includes(input.operationKey), false);
  assert.deepEqual(
    {
      value: redis.setCalls[0].value,
      expiryMode: redis.setCalls[0].expiryMode,
      ttlSeconds: redis.setCalls[0].ttlSeconds,
    },
    { value: "1", expiryMode: "EX", ttlSeconds: 900 }
  );
  assert.equal(input.previewsIssuedThisRequest.has(input.operationKey), true);
});

test("confirmation after a stored preview proceeds", async () => {
  const redis = new MemoryRedis();
  const previewInput = confirmationInput(redis, { confirmed: false });
  await requireCrossMessageConfirmation(previewInput);

  const confirmation = confirmationInput(redis);
  assert.equal(await requireCrossMessageConfirmation(confirmation), "proceed");
});

test("a preview token is single use", async () => {
  const redis = new MemoryRedis();
  await requireCrossMessageConfirmation(
    confirmationInput(redis, { confirmed: false })
  );

  assert.equal(
    await requireCrossMessageConfirmation(confirmationInput(redis)),
    "proceed"
  );
  assert.equal(
    await requireCrossMessageConfirmation(confirmationInput(redis)),
    "preview"
  );
});

test("a preview issued in the same request blocks confirmation", async () => {
  const redis = new MemoryRedis();
  const operationKey = confirmationInput(redis).operationKey;
  const input = confirmationInput(redis, {
    operationKey,
    previewsIssuedThisRequest: new Set([operationKey]),
  });

  assert.equal(await requireCrossMessageConfirmation(input), "preview");
  assert.equal(redis.tokens.size, 1);
});

test("Redis errors fail closed", async () => {
  const input = confirmationInput({
    async getdel() {
      throw new Error("Redis unavailable");
    },
    async set() {
      throw new Error("Redis unavailable");
    },
  });

  assert.equal(await requireCrossMessageConfirmation(input), "preview");
  assert.equal(input.previewsIssuedThisRequest.has(input.operationKey), true);
});

test("every chat route bulk gate uses the shared confirmation helper", () => {
  const routeSource = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8"
  );

  assert.doesNotMatch(
    routeSource,
    /!\s*[\w.]*confirmed\s*\|\|\s*bulkPreviewsIssued\.has\s*\(/
  );
  assert.doesNotMatch(routeSource, /JSON\.stringify\((operation|requestedTasks)\)/);
  assert.equal(
    (routeSource.match(/await requireCrossMessageConfirmation\(/g) || []).length,
    9,
    "all nine confirmation gates must use the shared helper"
  );
  assert.equal(
    (routeSource.match(/buildBulkOperationKey\(/g) || []).length,
    5,
    "all five model-input-dependent gates must use canonical operation keys"
  );
});
