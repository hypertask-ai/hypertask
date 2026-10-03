const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
require("tsx/cjs");
const { runCoreActionsSmoke } = require("../src/lib/productionSmoke/coreActions.ts");
const { CoreSmokeRunDeadlineError } = require("../src/lib/productionSmoke/lock.ts");

const fixture = {
  projectId: 71, taskId: 81, baseSectionId: 91, altSectionId: 92,
  userId: 17, userDisplayName: "Smoke User", agentId: "smoke-agent", agentDisplayName: "Smoke Agent",
};
const inboxSteps = [
  "inbox add task", "inbox list added task", "inbox task detail",
  "inbox task-page remove", "inbox verify task-page removal",
  "inbox undo task-page removal", "inbox verify task-page undo",
  "inbox row archive", "inbox verify row archive",
  "inbox undo row archive", "inbox verify row undo",
];

function fakeApp(options = {}) {
  const state = {
    sectionId: fixture.baseSectionId, assignees: [], comments: [], notifications: [],
    nextId: 100, toggles: 0, lists: 0, added: false, calls: [],
  };
  const task = () => ({ id: fixture.taskId, projectId: fixture.projectId, uniqueIndex: 1,
    sectionId: state.sectionId, ranking: "original", assignees: state.assignees });
  const active = () => state.notifications.filter((row) => row.status === "Normal");
  const json = (data, status = 200) => Response.json(data, { status });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    state.calls.push({ path, query: url.searchParams, method: init.method || "GET", body, signal: init.signal });
    assert.equal(init.headers.Cookie, "ht_session=smoke");
    assert.equal(url.origin, "https://app.hypertask.ai");
    init.signal?.throwIfAborted();
    if (path === "/api/tasks/single") return json(task());
    if (path === "/api/projects/boardTasks") return json({ tasks: [task()] });
    if (path === "/api/comments/getByTask") return json({ comments: state.comments });
    if (path === "/api/comments/create") {
      const row = { id: state.nextId++, text: body.text, creatorId: fixture.userId };
      state.comments.push(row);
      return json(row);
    }
    if (path === "/api/comments/updateComment") {
      const row = state.comments.find((row) => row.id === body.commentId);
      row.text = body.text;
      return json(row);
    }
    if (path === "/api/comments/deleteCommentById") {
      state.comments = state.comments.filter((row) => row.id !== body.id);
      return json({});
    }
    if (path === "/api/section/getProjectSections") return json([{ id: 91 }, { id: 92 }]);
    if (path === "/api/tasks/moveTask") {
      const row = { id: state.nextId++, activity: { type: "TaskMove", data: {
        fromUserId: fixture.userId, fromSection: { sectionId: state.sectionId }, toSection: { sectionId: body.sectionId },
      } } };
      state.comments.push(row);
      state.sectionId = body.sectionId;
      return json({ newComment: row });
    }
    if (path === "/api/assignees/assign") {
      state.assignees = body.intent === "assign" ? [{ userId: fixture.userId }] : [];
      const row = { id: state.nextId++, activity: { type: "TaskAssigned", data: {
        fromUserId: fixture.userId, toUser: { userId: fixture.userId }, updatedStatus: body.intent === "assign" ? "Assigned" : "Unassigned",
      } } };
      state.comments.push(row);
      return json({ activityCommentIds: [row.id] });
    }
    if (path === "/api/search/document") return json({ processedData: { All: [{ taskId: fixture.taskId }] } });
    if (path === "/api/notifications/moveTaskToInbox") {
      assert.deepEqual(body, { taskId: 81, projectId: 71, userId: 17 });
      state.added = true;
      const row = { id: 201, taskId: 81, projectId: 71, userId: 17, fromUserId: 17,
        agentId: null, type: "TaskMovedToInbox", status: "Normal", archivedAt: null };
      state.notifications.push(row);
      if (options.loseAdd) throw new Error("connection lost after inbox write");
      if (options.deadline) options.deadline.abort(new CoreSmokeRunDeadlineError());
      return json(options.addError ? { error: "add failed" } : { message: "Success" });
    }
    if (path === "/api/notifications/getAll") {
      state.lists += 1;
      if (options.failList === state.lists) return json({ message: "list failed" }, 500);
      if (options.malformedList === state.lists) return json({});
      if ((options.hideAdded && state.lists === 2) || options.hideList === state.lists) return json({ notifications: [] });
      if (options.staleList === state.lists) return json({ notifications: [{ id: 201, taskId: 81 }] });
      return json({ notifications: active() });
    }
    if (path === "/api/notifications/getAllInbox") return json(state.notifications.filter((row) => row.status === "Archive"));
    if (path === "/api/tasks/getTask") {
      assert.equal(url.searchParams.get("project"), "project-71");
      assert.equal(url.searchParams.get("uniqueIndex"), "1");
      const notifications = active().filter((row) => row.taskId === fixture.taskId && row.userId === fixture.userId && !row.agentId);
      return json({ ...task(), notifications: options.missingDetailRow ? [] : notifications,
        _count: { notifications: options.missingDetailCount ? 0 : notifications.length } });
    }
    if (path === "/api/notifications/markAsDone") {
      state.toggles += 1;
      assert.equal(url.searchParams.get("id"), "201");
      assert.equal(url.searchParams.get("taskId"), "81");
      assert.equal(url.searchParams.get("userId"), "17");
      assert.equal(url.searchParams.get("type"), "TaskMovedToInbox");
      assert.equal(init.method, "GET");
      if (options.failToggle === state.toggles) return json({ message: "This task is not in inbox" }, options.errorStatus || 400);
      const row = state.notifications.find((row) => row.id === 201);
      row.status = row.status === "Normal" ? "Archive" : "Normal";
      row.archivedAt = row.status === "Archive" ? "2026-10-03T00:00:00Z" : null;
      if (options.badUndo && state.toggles === 4) row.archivedAt = "stale";
      return json(row);
    }
    if (path === "/api/notifications/(un)archiveBulk") {
      assert.deepEqual(body, { notificationIds: [{ notificationId: 201, userId: 17 }], status: "Deleted" });
      if (options.failCleanup) return json({ error: "cleanup unavailable" }, 500);
      if (!options.staleCleanup) {
        state.notifications.find((row) => row.id === 201).status = "Deleted";
      }
      return json({ archivedCount: 1 });
    }
    throw new Error(`Unhandled ${path}`);
  };
  return { state, run: () => runCoreActionsSmoke({ baseUrl: "https://app.hypertask.ai", cookieHeader: "ht_session=smoke",
    fixture, runId: "inbox-test", fetchImpl, signal: options.deadline?.signal }) };
}

function assertClean(app) {
  assert.deepEqual(app.state.comments, []);
  assert.equal(app.state.sectionId, fixture.baseSectionId);
  assert.deepEqual(app.state.assignees, []);
  assert.equal(app.state.notifications.find((row) => row.id === 201)?.status, "Deleted");
}

test("all named inbox routines use the UI paths and clean up their notification", async () => {
  const app = fakeApp();
  const result = await app.run();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.steps.filter((step) => step.startsWith("inbox ")), inboxSteps);
  assert.ok(result.cleanup.includes("inbox deleted smoke notifications"));
  assertClean(app);
  const ui = fs.readFileSync("src/hooks/Inbox/useGlobalFocusHandler.tsx", "utf8");
  const undo = fs.readFileSync("src/utils/undoActions/helperFuncs.ts", "utf8");
  assert.match(ui, /\/api\/notifications\/markAsDone\?id=/);
  assert.match(undo, /\/api\/notifications\/markAsDone\?id=/);
  assert.match(fs.readFileSync("src/utils/controllers/tasks/getTask.ts", "utf8"), /fetchTaskDetail\(project, uniqueIndex, user.id\)/);
  assert.match(fs.readFileSync("src/app/detail/[...slug]/page.tsx", "utf8"), /fetchTaskDetail\(params.slug\[0\], params.slug\[1\], userObj.id\)/);
});

for (const [toggle, action] of [[1, "inbox task-page remove"], [2, "inbox undo task-page removal"],
  [3, "inbox row archive"], [4, "inbox undo row archive"]]) {
  for (const status of [400, 200]) {
    test(`${action}: not in inbox response at HTTP ${status} fails and cleans up`, async () => {
      const app = fakeApp({ failToggle: toggle, errorStatus: status });
      const result = await app.run();
      assert.equal(result.ok, false);
      assert.equal(result.kind, "application");
      assert.equal(result.action, action);
      assert.match(result.detail, /not in inbox/);
      assert.ok(!result.steps.includes(action));
      assertClean(app);
    });
  }
}

for (const [options, action] of [
  [{ addError: true }, "inbox add task"], [{ hideAdded: true }, "inbox list added task"],
  [{ missingDetailCount: true }, "inbox task detail"], [{ missingDetailRow: true }, "inbox task detail"],
  [{ staleList: 3 }, "inbox verify task-page removal"], [{ staleList: 6 }, "inbox verify row archive"],
  [{ failList: 2 }, "inbox list added task"], [{ malformedList: 2 }, "inbox list added task"],
  [{ hideList: 4 }, "inbox verify task-page undo"], [{ hideList: 7 }, "inbox verify row undo"],
  [{ failList: 8 }, "inbox cleanup discover active"],
  [{ badUndo: true }, "inbox undo row archive"], [{ loseAdd: true }, "inbox add task"],
  [{ failCleanup: true }, "inbox cleanup delete"], [{ staleCleanup: true }, "inbox cleanup verify"],
]) {
  test(`${action}: ${JSON.stringify(options)} is never green`, async () => {
    const app = fakeApp(options);
    const result = await app.run();
    assert.equal(result.ok, false);
    assert.equal(result.action, action, JSON.stringify(result));
    assert.deepEqual(app.state.comments, []);
    if (!options.failCleanup && !options.staleCleanup) assertClean(app);
  });
}

test("inbox cleanup failure preserves the original failed step and still cleans core data", async () => {
  const app = fakeApp({ failToggle: 1, failCleanup: true });
  const result = await app.run();
  assert.equal(result.action, "inbox task-page remove");
  assert.match(result.detail, /cleanup failed at inbox cleanup delete/);
  assert.deepEqual(app.state.comments, []);
  assert.deepEqual(app.state.assignees, []);
  assert.equal(app.state.sectionId, 91);
});

test("cleanup never deletes baseline, other-task, other-user, or agent notifications", async () => {
  const app = fakeApp();
  const rows = [
    { id: 202, taskId: 81, projectId: 71, userId: 17, fromUserId: 17, type: "TaskMovedToInbox", status: "Archive" },
    { id: 203, taskId: 99, projectId: 71, userId: 17, fromUserId: 17, type: "TaskMovedToInbox", status: "Normal" },
    { id: 204, taskId: 99, projectId: 71, userId: 18, fromUserId: 17, type: "TaskMovedToInbox", status: "Normal" },
    { id: 205, taskId: 99, projectId: 71, userId: 17, fromUserId: 17, agentId: "agent", type: "TaskMovedToInbox", status: "Normal" },
  ];
  app.state.notifications.push(...rows);
  const before = structuredClone(rows);
  const result = await app.run();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(rows, before);
  assertClean(app);
});

test("an occupied fixture inbox fails preflight without adding or deleting anything", async () => {
  const app = fakeApp();
  app.state.notifications.push({ id: 202, taskId: 81, status: "Normal" });
  const result = await app.run();
  assert.equal(result.action, "inbox baseline");
  assert.equal(result.ok, false);
  assert.ok(!app.state.calls.some((call) => call.path === "/api/notifications/moveTaskToInbox"));
  assert.ok(!app.state.calls.some((call) => call.path === "/api/notifications/(un)archiveBulk"));
});

test("safe-deadline cleanup uses a fresh signal", async () => {
  const deadline = new AbortController();
  const app = fakeApp({ deadline });
  await app.run();
  const deletes = app.state.calls.filter((call) => call.path === "/api/notifications/(un)archiveBulk");
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].signal.aborted, false);
  assertClean(app);
});
