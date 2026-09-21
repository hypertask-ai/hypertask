const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/agent-description-mention-invocation.test.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") } }
);

const {
  buildAgentInvocationSelector,
  hasAgentInvocationCorrelation,
  ConflictingInvocationCorrelationError,
  claimPendingAgentInvocation,
  DirectReplyAlreadyHandledError,
  AgentInvocationNotPendingError,
} = jiti(
  path.join(root, "src/utils/controllers/comments/agentInvocationCorrelation.ts")
);

const {
  getAddCommentInputSchema,
  getAddCommentCrudInputSchema,
} = jiti(path.join(root, "src/lib/mcp-server/validations/comment.validation.ts"));

const routeSource = fs.readFileSync(
  path.join(root, "src/app/api/mcp/comments/route.ts"),
  "utf8"
);
const followerJavascript = ts.transpileModule(fs.readFileSync(
  path.join(root, "src/utils/controllers/followers/createFollowerService.ts"),
  "utf8",
), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadCreateFollowerService() {
  const agentMentionCalls = [];
  const prisma = {
    agent: {
      findFirst: async () => ({ id: "agent-1", userId: 7 }),
    },
    task: {
      findUnique: async () => ({
        userId: 6,
        projectId: 15,
        agentId: "agent-1",
      }),
    },
  };
  const modules = {
    "@/utils/controllers/FCM": { sendDataNewCommentFCM: async () => {} },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": {
      __esModule: true,
      default: async () => null,
    },
    "@/utils/controllers/notifications/createAgentMentionNotification": {
      createAgentMentionNotification: async (input) => {
        agentMentionCalls.push(input);
      },
    },
    "@/utils/controllers/tasks/getSharedTask": {
      checkIfBoardMember: async () => 200,
    },
  };
  const loadedModule = { exports: {} };

  new Function("module", "exports", "require", followerJavascript)(
    loadedModule,
    loadedModule.exports,
    (request) => {
      if (modules[request]) return modules[request];
      throw new Error(`Unexpected import: ${request}`);
    },
  );

  return {
    createFollowerService: loadedModule.exports.createFollowerService,
    agentMentionCalls,
  };
}

// --- correlation selector ------------------------------------------------

test("a description mention correlates by its notification id", () => {
  assert.deepEqual(buildAgentInvocationSelector({ invocationId: 8821 }), {
    id: 8821,
  });
  assert.equal(hasAgentInvocationCorrelation({ invocationId: 8821 }), true);
});

test("a comment mention still correlates by its invoking comment", () => {
  assert.deepEqual(
    buildAgentInvocationSelector({ sourceCommentId: 183450 }),
    { commentId: 183450 }
  );
  assert.equal(
    hasAgentInvocationCorrelation({ sourceCommentId: 183450 }),
    true
  );
});

test("a routine agent comment carries no correlation and claims nothing", () => {
  assert.equal(buildAgentInvocationSelector({}), null);
  assert.equal(
    buildAgentInvocationSelector({
      sourceCommentId: null,
      invocationId: null,
    }),
    null
  );
  assert.equal(hasAgentInvocationCorrelation({}), false);
});

test("two conflicting pointers are rejected, not silently merged", () => {
  assert.throws(
    () =>
      buildAgentInvocationSelector({
        sourceCommentId: 183450,
        invocationId: 8821,
      }),
    ConflictingInvocationCorrelationError
  );
});

function notificationStore({ pending, claimCount = 1, winnerCommentId = null }) {
  const calls = { findFirst: [], updateMany: [], findUnique: [] };
  return {
    calls,
    store: {
      findFirst: async (args) => {
        calls.findFirst.push(args);
        if (
          pending &&
          ["id", "taskId", "agentId", "type", "status"].some(
            (key) =>
              pending[key] !== undefined && pending[key] !== args.where[key]
          )
        ) {
          return null;
        }
        return pending;
      },
      updateMany: async (args) => {
        calls.updateMany.push(args);
        return { count: claimCount };
      },
      findUnique: async (args) => {
        calls.findUnique.push(args);
        return { agentReplyCommentId: winnerCommentId };
      },
    },
  };
}

test("a description invocation is claimed once by notification id", async () => {
  const consumedAt = new Date("2026-08-21T12:00:00.000Z");
  const { store, calls } = notificationStore({
    pending: {
      id: 8821,
      fromUserId: 6,
      agentReplyConsumedAt: null,
      agentReplyCommentId: null,
    },
  });

  const requester = await claimPendingAgentInvocation({
    notifications: store,
    taskId: 27744,
    agentId: "agent-1",
    replyCommentId: 190001,
    hyperAiId: 332,
    invocationId: 8821,
    consumedAt,
  });

  assert.equal(requester, 6);
  assert.deepEqual(calls.findFirst[0].where, {
    taskId: 27744,
    agentId: "agent-1",
    type: "Mentioned",
    status: "Normal",
    agentReplyConsumedAt: null,
    fromAgentId: null,
    fromUserId: { not: 332 },
    id: 8821,
  });
  assert.deepEqual(calls.updateMany[0], {
    where: {
      id: 8821,
      taskId: 27744,
      agentId: "agent-1",
      type: "Mentioned",
      status: "Normal",
      agentReplyConsumedAt: null,
      fromAgentId: null,
      fromUserId: 6,
    },
    data: {
      agentReplyConsumedAt: consumedAt,
      agentReplyCommentId: 190001,
      status: "Archive",
      archivedAt: consumedAt,
    },
  });
});

test("an invocation from another task cannot be claimed", async () => {
  const { store, calls } = notificationStore({
    pending: {
      id: 8821,
      taskId: 99999,
      fromUserId: 6,
      agentReplyConsumedAt: null,
      agentReplyCommentId: null,
    },
  });

  await assert.rejects(
    claimPendingAgentInvocation({
      notifications: store,
      taskId: 27744,
      agentId: "agent-1",
      replyCommentId: 190001,
      hyperAiId: 332,
      invocationId: 8821,
    }),
    AgentInvocationNotPendingError
  );
  assert.equal(calls.updateMany.length, 0);
});

test("a concurrent retry returns the winning reply instead of claiming twice", async () => {
  const { store, calls } = notificationStore({
    pending: {
      id: 8821,
      fromUserId: 6,
      agentReplyConsumedAt: null,
      agentReplyCommentId: null,
    },
    claimCount: 0,
    winnerCommentId: 190000,
  });

  await assert.rejects(
    claimPendingAgentInvocation({
      notifications: store,
      taskId: 27744,
      agentId: "agent-1",
      replyCommentId: 190001,
      hyperAiId: 332,
      invocationId: 8821,
    }),
    (error) =>
      error instanceof DirectReplyAlreadyHandledError &&
      error.commentId === 190000,
  );
  assert.equal(calls.updateMany.length, 1);
  assert.equal(calls.findUnique.length, 1);
});

test("a routine agent comment never queries or consumes an invocation", async () => {
  const { store, calls } = notificationStore({ pending: null });
  const requester = await claimPendingAgentInvocation({
    notifications: store,
    taskId: 27744,
    agentId: "agent-1",
    replyCommentId: 190001,
    hyperAiId: 332,
  });

  assert.equal(requester, null);
  assert.equal(calls.findFirst.length, 0);
  assert.equal(calls.updateMany.length, 0);
});

// --- MCP surface ---------------------------------------------------------

const addCommentBase = {
  task_id: 27744,
  text: "<p>Answered.</p>",
};

test("add_comment accepts reply_to_invocation_id", () => {
  const parsed = getAddCommentInputSchema().parse({
    ...addCommentBase,
    reply_to_invocation_id: 8821,
  });
  assert.equal(parsed.reply_to_invocation_id, 8821);
});

test("add_comment rejects a non-positive reply_to_invocation_id", () => {
  assert.throws(() =>
    getAddCommentInputSchema().parse({
      ...addCommentBase,
      reply_to_invocation_id: 0,
    })
  );
});

test("add_comment rejects an unsafe reply_to_invocation_id", () => {
  assert.throws(() =>
    getAddCommentInputSchema().parse({
      ...addCommentBase,
      reply_to_invocation_id: Number.MAX_SAFE_INTEGER + 1,
    })
  );
});

test("add_comment rejects both reply pointers at once", () => {
  assert.throws(() =>
    getAddCommentInputSchema().parse({
      ...addCommentBase,
      reply_to_comment_id: 183450,
      reply_to_invocation_id: 8821,
    })
  );
});

test("reply_to_invocation_id is only available for add_comment action add", () => {
  const crud = getAddCommentCrudInputSchema();
  assert.equal(
    crud.parse({ action: "add", ...addCommentBase, reply_to_invocation_id: 8821 })
      .reply_to_invocation_id,
    8821
  );
  assert.throws(() =>
    crud.parse({
      action: "update",
      comment_id: 1,
      text: "<p>Edited.</p>",
      reply_to_invocation_id: 8821,
    })
  );
});

test("add_comment CRUD rejects both reply pointers at once", () => {
  assert.throws(() =>
    getAddCommentCrudInputSchema().parse({
      action: "add",
      ...addCommentBase,
      reply_to_comment_id: 183450,
      reply_to_invocation_id: 8821,
    })
  );
});

// --- API route boundary --------------------------------------------------

test("the API route gates reply_to_invocation_id to authenticated agents", () => {
  assert.match(
    routeSource,
    /reply_to_invocation_id !== undefined && !ctx\.agentId/
  );
  assert.match(
    routeSource,
    /!Number\.isSafeInteger\(reply_to_invocation_id\) \|\| reply_to_invocation_id <= 0/
  );
  assert.match(
    routeSource,
    /directReplyInvocationId: ctx\.agentId \? reply_to_invocation_id : undefined/
  );
});

test("a description mention still creates the durable agent invocation row", async () => {
  const { createFollowerService, agentMentionCalls } = loadCreateFollowerService();

  const response = await createFollowerService({
    agentId: "agent-1",
    taskId: 27744,
    mentionById: 6,
  });

  assert.equal(response.status, 201);
  assert.deepEqual(agentMentionCalls, [
    {
      agentId: "agent-1",
      taskId: 27744,
      projectId: 15,
      mentionedBy: 6,
      commentId: undefined,
      fromAgentId: undefined,
    },
  ]);
});
