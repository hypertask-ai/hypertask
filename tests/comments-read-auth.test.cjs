const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const projects = [
  { id: 15, ownerId: 42, members: [] },
  { id: 16, ownerId: 99, members: [{ userId: 42, agentId: null }] },
  { id: 17, ownerId: 99, members: [] },
  { id: 18, ownerId: 99, members: [{ userId: 42, agentId: "agent-only" }] },
];
const comments = projects.flatMap(({ id }) => [
  { id: id * 10, taskId: id, creatorId: 99, text: `comment ${id}` },
  { id: id * 10 + 1, taskId: id, creatorId: 42, text: `own comment ${id}` },
]);

function harness({ userId = 42 } = {}) {
  const calls = [];
  function accessible(projectId, where) {
    const project = projects.find(({ id }) => id === projectId);
    return where.OR.some((branch) => branch.ownerId === project.ownerId ||
      (branch.members && project.members.some((member) =>
        member.userId === branch.members.some.userId && member.agentId === branch.members.some.agentId)));
  }
  const mocks = {
    "@/lib/prisma": { default: {
      task: { findFirst: async (query) => {
        calls.push(["task", query]);
        const projectId = query.where.id;
        if (!projects.some(({ id }) => id === projectId)) return null;
        if (query.where.project && !accessible(projectId, query.where.project)) return null;
        return { id: projectId, projectId, title: `task ${projectId}`, uniqueIndex: projectId,
          project: projects.find(({ id }) => id === projectId) };
      } },
      comment: {
        findFirst: async (query) => {
          calls.push(["comment-access", query]);
          const comment = comments.find(c => c.id === query.where.id);
          if (!comment) return null;
          if (query.where.creatorId !== undefined && comment.creatorId !== query.where.creatorId) return null;
          if (query.where.task?.project && !accessible(comment.taskId, query.where.task.project)) return null;
          return { ...comment, task: { projectId: comment.taskId } };
        },
        updateMany: async (query) => { calls.push(["seen-write", query]); return { count: 1 }; },
        count: async (query) => {
          calls.push(["count", query]);
          return comments.filter((comment) =>
            (query.where.taskId === undefined || comment.taskId === query.where.taskId) &&
            (!query.where.task?.project || accessible(comment.taskId, query.where.task.project)) &&
            (!query.where.NOT || comment.creatorId !== query.where.NOT.creatorId)).length;
        },
        findMany: async (query) => {
          calls.push(["unscoped-comment-read", query]);
          return comments;
        },
      },
      $transaction: async (operation) => {
        calls.push(["transaction"]);
        return operation({ comment: { update: async (query) => ({ id: query.where.id, taskId: 15, text: query.data.text }) } });
      },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async (headers) => {
      assert.ok(headers instanceof Headers);
      calls.push(["session"]);
      return userId === null ? null : { userId, source: "better-auth" };
    } },
    "@/utils/controllers/taskDetail/load": { fetchCommentsForTask: async (taskId, viewerId) => {
      calls.push(["comments", { taskId, userId: viewerId }]);
      return comments.filter((comment) => comment.taskId === taskId);
    } },
    "@/utils/controllers/tasks/markRead": { getTaskReadStateLastReadAt: async (...args) => {
      calls.push(["read-state", args]);
      return "2026-10-08T12:00:00.000Z";
    } },
    "@/lib/agentRuns/service": { listTaskAgentRunActivities: async (...args) => {
      calls.push(["activity", args]);
      return [{ id: "run-1" }];
    } },
    "./readReceipts": { filterCommentReadReceipts: async (value) => {
      calls.push(["read-receipts"]);
      return value;
    }, omitCommentSeen: value => value },
    "@/lib/api/task-writes/route": {
      withTaskWriteFlag: handler => handler,
      taskWriteRoute: ({ operation }) => async (request, session) => operation(await request.json(), session),
    },
    "@/utils/controllers/notifications/getByTask": { default: async (...args) => { calls.push(["notifications", args]); } },
    "@/utils/controllers/comments/deleteCommentService": { deleteCommentService: async () => { calls.push(["delete"]); } },
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": { default: async () => false },
    "@/utils/controllers/notifications/shouldNotify": {},
    "@/lib/realtime/server": { broadcastTaskComment: async () => {} },
    "@/utils/controllers/FCM": {},
    "@/utils/controllers/notifications/mentionText": {},
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertCommentToTurbopuffer: () => {} },
    "@/pages/api/queues/FAST/generateSummary": { default: () => {} },
    "@/pages/api/queues/FAST/generateCommentSummary": { default: async () => {} },
    "./processMentions": { processMentionsFromCommentText: async () => {} },
    "@/lib/ai/hyperAiConfirmation": { invalidateHyperAiCommentOrigin: async () => { calls.push(["invalidation"]); } },
    "@/lib/mcp/normalizeBlockHtml": { normalizeBlockHtml: text => text },
    // Exercise the real board predicate, mocking only unrelated imports.
    "@/lib/agents/publicAgent": {},
    "@/lib/cycles": {},
    "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
  };
  async function request(route, query = {}, method = "GET") {
    const handler = load(`src/pages/api/comments/${route}.ts`, mocks).default;
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method, headers: {}, query, body: query }, res);
    return res;
  }
  async function typedSeen(body) {
    const handler = load("src/lib/api/notification-writes/comments-seen.ts", mocks).POST;
    const response = await handler({ headers: new Headers(), json: async () => body });
    return { statusCode: response.status, body: await response.json() };
  }
  return { request, calls, typedSeen };
}

for (const route of ["getByTask", "getCount", "getCountByTask"]) {
  test(`${route}: anonymous callers get 401 without content queries`, async () => {
    const h = harness({ userId: null });
    const res = await h.request(route, { taskId: "17", userId: "99" });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { message: "Unauthorized" });
    assert.deepEqual(h.calls.map(([kind]) => kind), ["session"]);
  });
}

for (const route of ["getByTask", "getCountByTask"]) {
  for (const taskId of [17, 18, 999]) {
    test(`${route}: inaccessible or missing task ${taskId} gets 404 before comments, activity or read state`, async () => {
      const h = harness();
      const res = await h.request(route, { taskId: String(taskId), userId: "99", projectId: "15" });
      assert.equal(res.statusCode, 404);
      assert.deepEqual(res.body, { message: "Task not found" });
      assert.deepEqual(h.calls.map(([kind]) => kind), ["session", "task"]);
      assert.deepEqual(h.calls[1][1].where.project, {
        OR: [{ ownerId: 42 }, { members: { some: { userId: 42, agentId: null } } }],
      });
    });
  }
  for (const taskId of [15, 16]) {
    test(`${route}: owner or human member reads task ${taskId} with unchanged response`, async () => {
      const h = harness();
      const res = await h.request(route, { taskId: String(taskId), userId: "99" });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(h.calls.slice(0, 2).map(([kind]) => kind), ["session", "task"]);
      if (route === "getByTask") {
        assert.deepEqual(res.body, { comments: comments.filter(c => c.taskId === taskId),
          lastReadAt: "2026-10-08T12:00:00.000Z", agentRunActivities: [{ id: "run-1" }] });
      } else {
        assert.deepEqual(res.body, { taskId: String(taskId), commentCount: 2 });
      }
    });
  }
}

test("getCount: aggregate counts other creators' comments only on accessible boards, ignoring supplied identity", async () => {
  const h = harness();
  const res = await h.request("getCount", { userId: "99", projectId: "17", taskId: "17" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 2);
  assert.deepEqual(h.calls.map(([kind]) => kind), ["session", "count"]);
  assert.deepEqual(h.calls[1][1].where, {
    NOT: { creatorId: 42 },
    task: { project: { OR: [{ ownerId: 42 }, { members: { some: { userId: 42, agentId: null } } }] } },
  });
});

test("getCount: a caller with no accessible boards receives zero, not a private board's count", async () => {
  const h = harness({ userId: 2343 });
  const res = await h.request("getCount", { userId: "985", taskId: "17" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 0);
  assert.deepEqual(h.calls.map(([kind]) => kind), ["session", "count"]);
});

for (const typed of [false, true]) {
  const route = typed ? "typed comments seen" : "updateSeen";
  for (const taskId of [17, 18, 999]) {
    test(`${route}: inaccessible task ${taskId} cannot read notifications or write seen state`, async () => {
      const h = harness();
      const body = { taskId, commentIds: [150, 170], userId: 99 };
      const res = typed ? await h.typedSeen(body) : await h.request("updateSeen", body, "POST");
      assert.equal(res.statusCode, 404);
      assert.deepEqual(res.body, { message: "Task not found" });
      assert.deepEqual(h.calls.map(([kind]) => kind), ["session", "task"]);
    });
  }
  test(`${route}: accessible task restricts supplied comment IDs to that task`, async () => {
    const h = harness();
    const body = { taskId: 15, commentIds: [150, 170], userId: 99 };
    const res = typed ? await h.typedSeen(body) : await h.request("updateSeen", body, "POST");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(h.calls.at(-1)[1].where, { id: { in: [150, 170] }, taskId: 15, NOT: { seen: { has: 42 } } });
  });
  test(`${route}: anonymous callers cannot write`, async () => {
    const h = harness({ userId: null });
    const body = { taskId: 15, commentIds: [150] };
    const res = typed ? await h.typedSeen(body) : await h.request("updateSeen", body, "POST");
    assert.equal(res.statusCode, 401);
    assert.deepEqual(h.calls.map(([kind]) => kind), ["session"]);
  });
}

for (const taskId of [17, 18, 999]) {
  test(`createMention: inaccessible task ${taskId} denies before any comment or notification query`, async () => {
    const h = harness();
    const res = await h.request("createMention", { taskId, projectId: taskId, userId: 99, commentId: taskId * 10 }, "POST");
    assert.equal(res.statusCode, 404);
    assert.deepEqual(h.calls.map(([kind]) => kind), ["session", "task"]);
  });
}

test("createMention: member can mention an accessible board owner", async () => {
  const h = harness();
  const res = await h.request("createMention", { taskId: 16, projectId: 16, userId: 99 }, "POST");
  assert.equal(res.statusCode, 200);
});

for (const taskId of [17, 18]) {
  test(`deleteCommentById: private comment on task ${taskId} cannot be deleted`, async () => {
    const h = harness();
    const res = await h.request("deleteCommentById", { id: taskId * 10 }, "POST");
    assert.equal(res.statusCode, 404);
    assert.deepEqual(h.calls.map(([kind]) => kind), ["session", "comment-access"]);
  });
  test(`updateComment: owning a comment on inaccessible task ${taskId} does not grant board access`, async () => {
    const h = harness();
    const res = await h.request("updateComment", { taskId: 15, commentId: taskId * 10 + 1, creatorId: 42, text: "changed" }, "PUT");
    assert.equal(res.statusCode, 404);
    assert.deepEqual(h.calls.map(([kind]) => kind), ["session", "comment-access"]);
  });
}

for (const route of ["deleteCommentById", "updateComment"]) {
  test(`${route}: accessible comments retain the mutation path`, async () => {
    const h = harness();
    const res = await h.request(route, { id: 151, taskId: 15, commentId: 151, creatorId: 42, text: "changed" }, route === "updateComment" ? "PUT" : "POST");
    assert.equal(res.statusCode, 200);
    assert.ok(h.calls.some(([kind]) => kind === (route === "updateComment" ? "transaction" : "delete")));
  });
}
