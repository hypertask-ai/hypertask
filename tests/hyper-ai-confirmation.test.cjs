const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/lib/ai/hyperAiConfirmation.ts"),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", "require", javascript)(
  loaded,
  loaded.exports,
  (request) => {
    if (request === "node:crypto") return require("node:crypto");
    if (request === "@/lib/redis") {
      return { getRedis: async () => { throw new Error("inject Redis"); } };
    }
    throw new Error(`Unexpected import: ${request}`);
  },
);

const {
  invalidateHyperAiCommentOrigin,
  isExplicitHyperAiApproval,
  isUneditedHyperAiComment,
  recordHyperAiCommentOrigin,
  requireHyperAiCommentConfirmation,
} = loaded.exports;

class MemoryRedis {
  constructor() {
    this.values = new Map();
  }
  async get(key) {
    return this.values.get(key) ?? null;
  }
  async getdel(key) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
  async del(key) {
    return this.values.delete(key) ? 1 : 0;
  }
  async set(key, value) {
    this.values.set(key, value);
    return "OK";
  }
}

function input(redis, overrides = {}) {
  return {
    userId: 6,
    sessionId: "hyperai:15:27017",
    operationKey: '["hypertask_update_task",{}]',
    sourceMessageId: "comment:100",
    sourceMessageText: "@HyperAI update the title",
    sourceMessageCreatedAt: new Date(),
    sourceMessageImmutable: true,
    previewsIssuedThisRequest: new Set(),
    getRedisClient: async () => redis,
    ...overrides,
  };
}

test("approval text is affirmative rather than a negated keyword match", () => {
  assert.equal(isExplicitHyperAiApproval("@HyperAI yes, proceed"), true);
  assert.equal(isExplicitHyperAiApproval("<p>@HyperAI confirm</p>"), true);
  assert.equal(isExplicitHyperAiApproval("@HyperAI do not confirm"), false);
  assert.equal(isExplicitHyperAiApproval("the word confirm appears here"), false);
  assert.equal(isExplicitHyperAiApproval("@HyperAI yes, do not proceed"), false);
  assert.equal(isExplicitHyperAiApproval("@HyperAI approved, but cancel"), false);
});

test("approval comment receipts reject edited text and mismatched authors/tasks", async () => {
  const redis = new MemoryRedis();
  const createdAt = new Date();
  const origin = {
    commentId: 101,
    userId: 6,
    taskId: 27017,
    agentId: null,
    text: "@HyperAI confirm",
    createdAt,
    getRedisClient: async () => redis,
  };

  await recordHyperAiCommentOrigin(origin);
  assert.equal(await isUneditedHyperAiComment(origin), true);
  assert.equal(
    await isUneditedHyperAiComment({ ...origin, text: "@HyperAI approved" }),
    false,
  );
  assert.equal(
    await isUneditedHyperAiComment({ ...origin, userId: 7 }),
    false,
  );
  assert.equal(
    await isUneditedHyperAiComment({ ...origin, taskId: 27018 }),
    false,
  );
  assert.equal(
    await isUneditedHyperAiComment({ ...origin, agentId: "agent-1" }),
    false,
  );
  assert.equal(
    await isUneditedHyperAiComment({
      ...origin,
      createdAt: new Date(createdAt.getTime() + 1),
    }),
    false,
  );
});

test("an edited comment stays ineligible after its original text is restored", async () => {
  const redis = new MemoryRedis();
  const origin = {
    commentId: 102,
    userId: 6,
    taskId: 27017,
    agentId: null,
    text: "@HyperAI confirm",
    createdAt: new Date(),
    getRedisClient: async () => redis,
  };

  await recordHyperAiCommentOrigin(origin);
  await invalidateHyperAiCommentOrigin(origin.commentId, origin.getRedisClient);
  assert.equal(await isUneditedHyperAiComment(origin), false);
});

test("comment edits fail closed when their immutable receipt cannot be invalidated", async () => {
  await assert.rejects(
    invalidateHyperAiCommentOrigin(102, async () => {
      throw new Error("Redis unavailable");
    }),
    /Redis unavailable/,
  );
});

test("a replay of the preview message cannot execute the write", async () => {
  const redis = new MemoryRedis();
  assert.equal(await requireHyperAiCommentConfirmation(input(redis)), "preview");
  assert.equal(
    await requireHyperAiCommentConfirmation(
      input(redis, {
        confirmed: true,
        sourceMessageText: "@HyperAI confirm",
        sourceMessageCreatedAt: new Date(Date.now() + 1_000),
      }),
    ),
    "preview",
  );
  assert.equal(redis.values.size, 2);
});

test("only an explicit, distinct later comment atomically consumes approval", async () => {
  const redis = new MemoryRedis();
  await requireHyperAiCommentConfirmation(input(redis));

  assert.equal(
    await requireHyperAiCommentConfirmation(
      input(redis, {
        confirmed: true,
        sourceMessageId: "comment:101",
        sourceMessageText: "@HyperAI do not confirm",
        sourceMessageCreatedAt: new Date(Date.now() + 1_000),
      }),
    ),
    "preview",
  );
  assert.equal(redis.values.size, 2);

  assert.equal(
    await requireHyperAiCommentConfirmation(
      input(redis, {
        confirmed: true,
        sourceMessageId: "comment:102",
        sourceMessageText: "@HyperAI approved",
        sourceMessageCreatedAt: new Date(Date.now() + 2_000),
      }),
    ),
    "proceed",
  );
  assert.equal(redis.values.size, 0);
});

test("one approval comment can consume only the active session proposal", async () => {
  const redis = new MemoryRedis();
  await requireHyperAiCommentConfirmation(input(redis));
  await requireHyperAiCommentConfirmation(
    input(redis, {
      operationKey: '["hypertask_add_comment_to_task",{}]',
      sourceMessageId: "comment:101",
      sourceMessageCreatedAt: new Date(Date.now() + 1_000),
    }),
  );

  const approval = {
    confirmed: true,
    sourceMessageId: "comment:102",
    sourceMessageText: "@HyperAI confirm",
    sourceMessageCreatedAt: new Date(Date.now() + 2_000),
  };
  assert.equal(
    await requireHyperAiCommentConfirmation(input(redis, approval)),
    "preview",
  );
  assert.equal(
    await requireHyperAiCommentConfirmation(
      input(redis, {
        ...approval,
        operationKey: '["hypertask_add_comment_to_task",{}]',
      }),
    ),
    "preview",
  );
});

test("an edited or unverifiable approval comment cannot consume a proposal", async () => {
  const redis = new MemoryRedis();
  await requireHyperAiCommentConfirmation(input(redis));

  assert.equal(
    await requireHyperAiCommentConfirmation(
      input(redis, {
        confirmed: true,
        sourceMessageId: "comment:102",
        sourceMessageText: "@HyperAI confirm",
        sourceMessageCreatedAt: new Date(Date.now() + 2_000),
        sourceMessageImmutable: false,
      }),
    ),
    "preview",
  );
  assert.equal(redis.values.size, 2);
});

test("missing state and Redis failures stay in preview", async () => {
  const redis = new MemoryRedis();
  assert.equal(
    await requireHyperAiCommentConfirmation(
      input(redis, {
        confirmed: true,
        sourceMessageId: "comment:200",
        sourceMessageText: "@HyperAI confirm",
        sourceMessageCreatedAt: new Date(Date.now() + 1_000),
      }),
    ),
    "preview",
  );

  const broken = input(redis, {
    getRedisClient: async () => { throw new Error("unavailable"); },
  });
  assert.equal(await requireHyperAiCommentConfirmation(broken), "preview");
});

test("older comments and description text cannot approve a pending write", async () => {
  const redis = new MemoryRedis();
  const previewedAt = Date.now();
  await requireHyperAiCommentConfirmation(
    input(redis, { sourceMessageCreatedAt: new Date(previewedAt - 10_000) }),
  );

  assert.equal(
    await requireHyperAiCommentConfirmation(
      input(redis, {
        confirmed: true,
        sourceMessageId: "comment:99",
        sourceMessageText: "@HyperAI confirm",
        sourceMessageCreatedAt: new Date(previewedAt - 1_000),
      }),
    ),
    "preview",
  );
  assert.equal(
    await requireHyperAiCommentConfirmation(
      input(redis, {
        confirmed: true,
        sourceMessageId: "description:27017",
        sourceMessageText: "@HyperAI confirm",
        sourceMessageCreatedAt: null,
      }),
    ),
    "preview",
  );
  assert.equal(redis.values.size, 2);
});
