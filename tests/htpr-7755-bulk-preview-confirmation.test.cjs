const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const { requireCrossMessageConfirmation } = load("src/lib/ai/bulkConfirmation.ts", {
  "@/lib/redis": { getRedis: async () => { throw new Error("Inject Redis"); } },
});

class MemoryRedis {
  constructor() {
    this.sets = new Map();
    this.tokens = new Map();
  }

  multi() {
    const commands = [];
    const transaction = {
      sadd: (key, ...members) => {
        commands.push(() => {
          const set = this.sets.get(key) ?? new Set();
          let added = 0;
          for (const member of members) {
            if (!set.has(member)) added++;
            set.add(member);
          }
          this.sets.set(key, set);
          return added;
        });
        return transaction;
      },
      expire: () => {
        commands.push(() => 1);
        return transaction;
      },
      exec: async () => commands.map((command) => [null, command()]),
    };
    return transaction;
  }

  async srem(key, ...members) {
    return members.filter((member) => this.sets.get(key)?.delete(member)).length;
  }

  async del(key) {
    return this.sets.delete(key) ? 1 : 0;
  }

  async set(key, value) {
    this.tokens.set(key, value);
  }

  async getdel(key) {
    const value = this.tokens.get(key) ?? null;
    this.tokens.delete(key);
    return value;
  }
}

function toolTurn(mode, redis, writes, enabled = true, sessionId = "chat-7755") {
  const stubs = {
    ai: { tool: (definition) => definition },
    "./updateOneTask": {
      createTaskUpdater: (_context, input) => async (_identifier, resolution) => {
        writes.push({ id: resolution.task.id, change: input.status ?? input.priority });
        return { success: true, task: { id: resolution.task.id } };
      },
    },
    "./taskAssigneeMutation": {
      createSingleTaskAssigneeMutation: (_context, _input, intent) => async ({ resolution }) => {
        writes.push({ id: resolution.task.id, change: intent });
        return { success: true, task: { task_id: resolution.task.id, changed: 1 } };
      },
    },
    "@/lib/ai/bulkConfirmation": {
      requireCrossMessageConfirmation: (input) => requireCrossMessageConfirmation({ ...input, getRedisClient: async () => redis }),
    },
    "@/lib/prisma": {
      default: {
        task: { findUnique: async ({ where }) => ({ id: where.id, title: "Task", projectId: 15, uniqueIndex: where.id, userId: 985 }) },
        user: { findUnique: async () => ({ id: 985, displayName: "QA" }) },
        comment: { findUnique: async () => null },
      },
    },
    "@/lib/ai/tools/execution": {
      withToolErrors: (fn) => fn,
      dropEmptyPadding: (value) => value,
      resolveTaskForTool: async (_user, { task_id }) => ({ task: { id: task_id, projectId: 15 } }),
    },
    "@/lib/ai/tools/helpers": {
      sanitizeForJson: (value) => value,
      buildActivityUser: (value) => value,
      commentInclude: () => ({}),
    },
    "@/utils/controllers/projects/getProjectMembers": { getProjectMembers: async () => ({ members: [{ id: 985, displayName: "QA" }, { id: 42, displayName: "Other" }] }) },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (value) => value },
    "@/utils/helperFunctions/toStoredHtml": { toStoredHtml: (value) => value },
    "@/utils/controllers/comments/processMentions": { resolveTextMentions: async (value) => value },
    "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async (value) => value },
    "@/utils/controllers/comments/createCommentService": {
      createCommentService: async ({ taskId, text }) => {
        writes.push({ id: taskId, change: text });
        return { id: 100 + taskId };
      },
    },
    "@/utils/controllers/urls/extractUrlsFromContent": { persistUrlsForComment: async () => {} },
    "@/lib/realtime/server": { broadcastTaskComment() {} },
    "@/lib/flags": {},
    "@/lib/ai/chatStream/prompt": { COMMENT_TASK_LINK_RULE: "" },
    "@/lib/ai/chatStream/errors": { errorMessage: (error) => error.message },
  };
  const context = {
    user: { id: 985 }, requestingUserId: 985, actingAgentId: null,
    confirmationSessionId: sessionId, bulkPreviewsIssued: new Set(),
    bulkScopeConfirmationEnabled: enabled, inlineAgentImagesEnabled: false,
    sendStatus() {}, body: {},
  };
  if (mode === "assign" || mode === "unassign") {
    const mutate = load("src/lib/ai/tools/taskAssignees.ts", stubs).createTaskAssigneeMutation(context);
    return (input) => mutate(input, mode);
  }
  const tool = mode === "comment"
    ? load("src/lib/ai/tools/addComment.ts", stubs).createAddCommentTool(context).hypertask_add_comment
    : load("src/lib/ai/tools/updateTask.ts", stubs).createUpdateTaskTool(context).hypertask_update_task;
  return (input) => tool.execute(tool.inputSchema.parse(input));
}

function inputFor(mode, ids, confirmed, changed = false) {
  return {
    task_ids: ids,
    ...(mode === "archive" ? { status: changed ? "Deleted" : "Archive" }
      : mode === "status" ? { priority: changed ? "Low" : "High" }
        : mode === "comment" ? { text: changed ? "Different comment" : "Approved comment" }
          : { user_ids: [changed ? 42 : 985] }),
    ...(confirmed !== undefined ? { confirmed } : {}),
  };
}

const scope = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const previewBatches = [scope.slice(0, 4), scope.slice(4, 8), scope.slice(8)];

for (const mode of ["archive", "status", "assign", "unassign", "comment"]) {
  test(`${mode}: one yes survives unchanged re-previews and different internal batches`, async () => {
    const redis = new MemoryRedis();
    const writes = [];
    const preview = toolTurn(mode, redis, writes);
    for (const ids of previewBatches) {
      assert.equal((await preview(inputFor(mode, ids, false))).confirmation_required, true);
    }
    assert.deepEqual(writes, []);

    const yes = toolTurn(mode, redis, writes);
    for (const ids of previewBatches) {
      assert.equal((await yes(inputFor(mode, ids, false))).confirmation_required, true);
    }
    assert.deepEqual(writes, []);
    for (const ids of [scope.slice(0, 3), scope.slice(3, 6), scope.slice(6)]) {
      assert.equal((await yes(inputFor(mode, ids, true))).success, true);
    }
    const change = mode === "archive" ? "Archive" : mode === "status" ? "High" : mode === "comment" ? "Approved comment" : mode;
    assert.deepEqual(writes.sort((a, b) => a.id - b.id), scope.map((id) => ({ id, change })));

    assert.equal((await toolTurn(mode, redis, writes)(inputFor(mode, scope, true))).confirmation_required, true);
    assert.equal(writes.length, 9);
  });

  test(`${mode}: no preview, no yes, same-turn yes, changed scope and changed action remain refused`, async () => {
    const redis = new MemoryRedis();
    const writes = [];
    const first = toolTurn(mode, redis, writes);
    assert.equal((await first(inputFor(mode, scope, true))).confirmation_required, true);
    assert.equal((await first(inputFor(mode, scope, true))).confirmation_required, true);
    assert.deepEqual(writes, []);

    const turn = toolTurn(mode, redis, writes);
    assert.equal((await turn(inputFor(mode, scope, false))).confirmation_required, true);
    assert.deepEqual(writes, []);
    assert.equal((await turn(inputFor(mode, [1, 2, 3, 99], true))).confirmation_required, true);
    assert.equal((await turn(inputFor(mode, scope, true))).confirmation_required, true);
    assert.equal((await toolTurn(mode, redis, writes)(inputFor(mode, scope, true, true))).confirmation_required, true);
    assert.deepEqual(writes, []);

    const allowed = await toolTurn(mode, redis, writes)(inputFor(mode, scope, true));
    assert.equal(allowed.success, true);
    assert.deepEqual(writes.map(({ id }) => id).sort((a, b) => a - b), scope);
  });

  test(`${mode}: a tail batch cannot write while the first preview is still awaiting a yes`, async () => {
    const redis = new MemoryRedis();
    const writes = [];
    const preview = toolTurn(mode, redis, writes);
    assert.equal((await preview(inputFor(mode, scope.slice(0, 8), false))).confirmation_required, true);
    assert.equal((await preview(inputFor(mode, scope.slice(8)))).confirmation_required, true);
    assert.deepEqual(writes, []);
    const yes = toolTurn(mode, redis, writes);
    assert.equal((await yes(inputFor(mode, scope, true))).success, true);
    assert.deepEqual(writes.map(({ id }) => id).sort((a, b) => a - b), scope);
  });
}

test("flag off retains the existing same-turn re-preview refusal", async () => {
  const redis = new MemoryRedis();
  const writes = [];
  await toolTurn("archive", redis, writes, false)(inputFor("archive", scope, false));
  const turn = toolTurn("archive", redis, writes, false);
  assert.equal((await turn(inputFor("archive", scope, false))).confirmation_required, true);
  assert.equal((await turn(inputFor("archive", scope, true))).confirmation_required, true);
  assert.deepEqual(writes, []);
  assert.equal((await toolTurn("archive", redis, writes, false)(inputFor("archive", scope, true))).success, true);
  assert.deepEqual(writes.map(({ id }) => id).sort((a, b) => a - b), scope);
});

test("a preview stays bound to its chat session", async () => {
  const redis = new MemoryRedis();
  const writes = [];
  await toolTurn("archive", redis, writes)(inputFor("archive", scope, false));
  assert.equal((await toolTurn("archive", redis, writes, true, "other-chat")(inputFor("archive", scope, true))).confirmation_required, true);
  assert.deepEqual(writes, []);
  assert.equal((await toolTurn("archive", redis, writes)(inputFor("archive", scope, true))).success, true);
  assert.deepEqual(writes.map(({ id }) => id).sort((a, b) => a - b), scope);
});
