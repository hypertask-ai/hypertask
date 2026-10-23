const test = require("node:test");
const assert = require("node:assert/strict");

const { load } = require("./task-route-loader.cjs");

const { buildBulkOperationKey, bulkOperationSubjectKeys } = load(
  "src/app/api/ai/chat/stream/bulkTools.ts",
  {}
);
const confirmationModule = load("src/lib/ai/bulkConfirmation.ts", {
  "@/lib/redis": {
    getRedis: async () => {
      throw new Error("Tests must inject Redis");
    },
  },
});
const { requireCrossMessageConfirmation } = confirmationModule;

class MemorySetRedis {
  constructor({ failExpiry = false } = {}) {
    this.sets = new Map();
    this.expiries = new Map();
    this.failExpiry = failExpiry;
  }

  multi() {
    const queued = [];
    const transaction = {
      sadd: (key, ...members) => {
        queued.push(() => {
          const set = this.sets.get(key) ?? new Set();
          members.forEach((member) => set.add(member));
          this.sets.set(key, set);
        });
        return transaction;
      },
      expire: (key, ttlSeconds) => {
        queued.push(() => this.expiries.set(key, ttlSeconds));
        return transaction;
      },
      exec: async () => {
        if (this.failExpiry) {
          queued[0]();
          return [[null, 1], [new Error("expire failed")]];
        }
        queued.forEach((apply) => apply());
        return queued.map(() => [null, 1]);
      },
    };
    return transaction;
  }

  async del(key) {
    this.expiries.delete(key);
    return this.sets.delete(key) ? 1 : 0;
  }

  async srem(key, ...members) {
    const set = this.sets.get(key) ?? new Set();
    return members.filter((member) => set.delete(member)).length;
  }

  async getdel() {
    throw new Error("scoped confirmation must not use single-operation tokens");
  }

  async set() {
    throw new Error("scoped confirmation must not use single-operation tokens");
  }
}

const doneTaskIds = Array.from({ length: 128 }, (_, index) => 1000 + index);
const todoTaskIds = [5001, 5002];

function batches(ids, sizes) {
  const result = [];
  let start = 0;
  for (const size of sizes) {
    result.push(ids.slice(start, start + size));
    start += size;
  }
  return result;
}

function updateCall(redis, taskIds, { confirmed, request, change = "Archive" }) {
  return requireCrossMessageConfirmation({
    userId: 985,
    sessionId: "chat-7693",
    operationKey: buildBulkOperationKey("update-tasks", [], [["status", change]]),
    subjectKeys: bulkOperationSubjectKeys(
      taskIds.map((taskId) => ({ identifier: { task_id: taskId }, resolvedTaskId: taskId }))
    ),
    confirmed,
    previewsIssuedThisRequest: request,
    getRedisClient: async () => redis,
  });
}

async function previewAll(redis, ids, sizes) {
  const request = new Set();
  for (const batch of batches(ids, sizes)) {
    assert.equal(await updateCall(redis, batch, { confirmed: false, request }), "preview");
  }
}

test("now works: one yes archives all 128 previewed Done tasks across batches", async () => {
  const redis = new MemorySetRedis();
  await previewAll(redis, doneTaskIds, [50, 50, 28]);

  const yes = new Set();
  for (const batch of batches(doneTaskIds, [50, 50, 28])) {
    assert.equal(await updateCall(redis, batch, { confirmed: true, request: yes }), "proceed");
  }
});

test("now works: the yes still applies when the batches are split differently", async () => {
  const redis = new MemorySetRedis();
  await previewAll(redis, doneTaskIds, [50, 50, 28]);

  const yes = new Set();
  for (const batch of batches([...doneTaskIds].reverse(), [40, 40, 48])) {
    assert.equal(await updateCall(redis, batch, { confirmed: true, request: yes }), "proceed");
  }
});

test("still refused: no archive without any preview, even when the AI says confirmed", async () => {
  const redis = new MemorySetRedis();
  const yes = new Set();
  assert.equal(await updateCall(redis, doneTaskIds.slice(0, 50), { confirmed: true, request: yes }), "preview");
});

test("still refused: no archive without a yes", async () => {
  const redis = new MemorySetRedis();
  await previewAll(redis, doneTaskIds, [50, 50, 28]);
  assert.equal(
    await updateCall(redis, doneTaskIds.slice(0, 50), { confirmed: false, request: new Set() }),
    "preview"
  );
});

test("still refused: a yes for 128 Done tasks does not archive Todo tasks", async () => {
  const redis = new MemorySetRedis();
  await previewAll(redis, doneTaskIds, [50, 50, 28]);

  const yes = new Set();
  assert.equal(await updateCall(redis, todoTaskIds, { confirmed: true, request: yes }), "preview");
  assert.equal(
    await updateCall(redis, [...doneTaskIds.slice(0, 10), todoTaskIds[0]], { confirmed: true, request: new Set() }),
    "preview"
  );
});

test("still refused: a yes to archive does not delete the same tasks", async () => {
  const redis = new MemorySetRedis();
  await previewAll(redis, doneTaskIds, [50, 50, 28]);
  assert.equal(
    await updateCall(redis, doneTaskIds.slice(0, 50), { confirmed: true, request: new Set(), change: "Deleted" }),
    "preview"
  );
});

test("still refused: a yes is used once per task", async () => {
  const redis = new MemorySetRedis();
  await previewAll(redis, doneTaskIds, [50, 50, 28]);
  const batch = doneTaskIds.slice(0, 50);
  assert.equal(await updateCall(redis, batch, { confirmed: true, request: new Set() }), "proceed");
  assert.equal(await updateCall(redis, batch, { confirmed: true, request: new Set() }), "preview");
});

test("still refused: a preview in the same message blocks confirmed calls in that message", async () => {
  const redis = new MemorySetRedis();
  const request = new Set();
  assert.equal(await updateCall(redis, doneTaskIds.slice(0, 50), { confirmed: false, request }), "preview");
  assert.equal(await updateCall(redis, doneTaskIds.slice(0, 50), { confirmed: true, request }), "preview");
});

test("still refused: Redis errors fail closed", async () => {
  const request = new Set();
  const result = await requireCrossMessageConfirmation({
    userId: 985,
    sessionId: "chat-7693",
    operationKey: buildBulkOperationKey("update-tasks", [], [["status", "Archive"]]),
    subjectKeys: ["task:1", "task:2"],
    confirmed: true,
    previewsIssuedThisRequest: request,
    getRedisClient: async () => {
      throw new Error("redis down");
    },
  });
  assert.equal(result, "preview");
});

test("previews keep an expiring, session-bound scope", async () => {
  const redis = new MemorySetRedis();
  await previewAll(redis, doneTaskIds, [50, 50, 28]);
  const [key] = [...redis.sets.keys()];
  assert.match(key, /^ai_bulk_scope:985:chat-7693:[0-9a-f]{64}$/);
  assert.equal(redis.expiries.get(key), 900);

  const otherSession = await requireCrossMessageConfirmation({
    userId: 985,
    sessionId: "another-chat",
    operationKey: buildBulkOperationKey("update-tasks", [], [["status", "Archive"]]),
    subjectKeys: bulkOperationSubjectKeys([{ identifier: { task_id: 1000 }, resolvedTaskId: 1000 }]),
    confirmed: true,
    previewsIssuedThisRequest: new Set(),
    getRedisClient: async () => redis,
  });
  assert.equal(otherSession, "preview");
});

test("still refused: a failed expiry write leaves no usable scope", async () => {
  const redis = new MemorySetRedis({ failExpiry: true });
  await previewAll(redis, doneTaskIds, [50, 50, 28]);
  assert.equal(redis.sets.size, 0, "a scope stored without its expiry must be deleted");
  redis.failExpiry = false;
  assert.equal(
    await updateCall(redis, doneTaskIds.slice(0, 50), { confirmed: true, request: new Set() }),
    "preview"
  );
  assert.equal(redis.sets.size, 1);
  assert.equal(redis.expiries.size, 1);
});

function loadUpdateTool(redis, updated, request) {
  const stubs = {
    ai: { tool: (definition) => definition },
    "./updateOneTask": {
      createTaskUpdater: () => async (_identifier, resolution) => {
        updated.push(resolution.task.id);
        return { success: true, task: { id: resolution.task.id } };
      },
    },
    "@/lib/ai/bulkConfirmation": {
      requireCrossMessageConfirmation: (input) =>
        requireCrossMessageConfirmation({ ...input, getRedisClient: async () => redis }),
    },
    "@/lib/prisma": {
      default: {
        task: {
          findUnique: async ({ where }) => ({ id: where.id, title: "Task", projectId: 7049, uniqueIndex: where.id }),
        },
      },
    },
    "@/lib/ai/tools/execution": {
      withToolErrors: (fn) => fn,
      dropEmptyPadding: (value) => value,
      resolveTaskForTool: async (_user, { task_id }) => ({ task: { id: task_id } }),
    },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value) => value },
    "@/lib/media/inlineAgentImages.server": {},
    "@/lib/ai/chatStream/errors": {},
    "@/lib/constants/constants": {},
    "@/lib/mcp/tasks/services": {},
    "@/utils/helperFunctions/toStoredHtml": {},
    "@/utils/controllers/getMemberAndOwnerForBoard": {},
    "@/utils/controllers/comments/processMentions": {},
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/utils/controllers/comments/createCommentService": {},
    "@/utils/controllers/urls/extractUrlsFromContent": {},
    "@/lib/realtime/server": {},
    "@/lib/flags": {},
    "@/lib/ai/chatStream/prompt": { COMMENT_TASK_LINK_RULE: "" },
    "@/app/api/ai/_lib/taskWriterDraft": {},
    "@/app/api/ai/_lib/taskWriterRun": {},
    "@/utils/controllers/agents/boardMembers": {},
  };
  const context = {
    inlineAgentImagesEnabled: false,
    chatTaskWriterEnabled: false,
    user: { id: 985 },
    confirmationSessionId: "chat-7693",
    bulkPreviewsIssued: request,
    sendStatus() {},
  };
  const tool = load("src/lib/ai/tools/updateTask.ts", stubs).createUpdateTaskTool(context).hypertask_update_task;
  return (input) => tool.execute(tool.inputSchema.parse(input));
}

test("now works through the chat tool: 51 archives preview in two calls, one yes runs both", async () => {
  const redis = new MemorySetRedis();
  const scope = doneTaskIds.slice(0, 51);
  const previewed = [];
  const previewTurn = loadUpdateTool(redis, previewed, new Set());
  const first = await previewTurn({ task_ids: scope.slice(0, 50), status: "Archive", confirmed: false });
  const last = await previewTurn({ task_ids: scope.slice(50), status: "Archive" });
  assert.equal(first.confirmation_required, true);
  assert.equal(last.confirmation_required, true);
  assert.deepEqual(previewed, []);

  const archived = [];
  const yesTurn = loadUpdateTool(redis, archived, new Set());
  await yesTurn({ task_ids: scope.slice(0, 50), status: "Archive", confirmed: true });
  await yesTurn({ task_ids: scope.slice(50), status: "Archive", confirmed: true });
  assert.deepEqual([...archived].sort(), [...scope].sort());
});

test("still refused through the chat tool: a one-task batch previewed first changes nothing", async () => {
  const redis = new MemorySetRedis();
  const scope = doneTaskIds.slice(0, 51);
  const previewed = [];
  const previewTurn = loadUpdateTool(redis, previewed, new Set());
  const single = await previewTurn({ task_ids: scope.slice(0, 1), status: "Archive", confirmed: false });
  const rest = await previewTurn({ task_ids: scope.slice(1), status: "Archive", confirmed: false });
  assert.equal(single.confirmation_required, true);
  assert.equal(rest.confirmation_required, true);
  assert.deepEqual(previewed, []);

  const archived = [];
  const yesTurn = loadUpdateTool(redis, archived, new Set());
  await yesTurn({ task_ids: scope.slice(1), status: "Archive", confirmed: true });
  await yesTurn({ task_ids: scope.slice(0, 1), status: "Archive", confirmed: true });
  assert.deepEqual([...archived].sort(), [...scope].sort());
});

test("still refused through the chat tool: an explicit preview of a small batch changes nothing", async () => {
  const redis = new MemorySetRedis();
  const updated = [];
  const previewTurn = loadUpdateTool(redis, updated, new Set());
  const result = await previewTurn({ task_ids: [1, 2], priority: "High", confirmed: false });
  assert.equal(result.confirmation_required, true);
  assert.deepEqual(updated, []);
});

test("still allowed through the chat tool: a single-task archive needs no yes", async () => {
  const redis = new MemorySetRedis();
  const updated = [];
  const turn = loadUpdateTool(redis, updated, new Set());
  await turn({ task_ids: [todoTaskIds[0]], status: "Archive" });
  assert.deepEqual(updated, [todoTaskIds[0]]);
});

test("still refused through the chat tool: a yes for Done tasks does not archive Todo tasks", async () => {
  const redis = new MemorySetRedis();
  const previewTurn = loadUpdateTool(redis, [], new Set());
  await previewTurn({ task_ids: doneTaskIds.slice(0, 50), status: "Archive", confirmed: false });
  const archived = [];
  const yesTurn = loadUpdateTool(redis, archived, new Set());
  const result = await yesTurn({ task_ids: todoTaskIds, status: "Archive", confirmed: true });
  assert.equal(result.confirmation_required, true);
  assert.deepEqual(archived, []);
});
