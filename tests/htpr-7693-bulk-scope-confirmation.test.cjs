const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/ai-bulk-confirmation-entry.cjs"), {
  interopDefault: true,
});
const { buildBulkOperationKey, bulkOperationSubjectKeys } = jiti(
  path.join(root, "src/app/api/ai/chat/stream/bulkTools.ts")
);

const helperJavascript = ts.transpileModule(
  fs.readFileSync(path.join(root, "src/lib/ai/bulkConfirmation.ts"), "utf8"),
  {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;
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

class MemorySetRedis {
  constructor() {
    this.sets = new Map();
    this.expiries = new Map();
  }

  async sadd(key, ...members) {
    const set = this.sets.get(key) ?? new Set();
    members.forEach((member) => set.add(member));
    this.sets.set(key, set);
    return members.length;
  }

  async srem(key, ...members) {
    const set = this.sets.get(key) ?? new Set();
    return members.filter((member) => set.delete(member)).length;
  }

  async expire(key, ttlSeconds) {
    this.expiries.set(key, ttlSeconds);
    return 1;
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

test("the chat update tool binds the yes to the change and the previewed tasks", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/ai/tools/updateTask.ts"), "utf8");
  assert.match(source, /operationKey: buildBulkOperationKey\("update-tasks", \[\], operationChanges\)/);
  assert.match(source, /subjectKeys: bulkOperationSubjectKeys\(operationSubjects\)/);
  assert.match(source, /call this tool now without confirmed for the remaining batches too/);
});
