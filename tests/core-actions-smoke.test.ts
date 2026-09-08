import assert from "node:assert/strict";
import test from "node:test";

import {
  CORE_SMOKE_AGENT_NAME,
  CORE_SMOKE_TASK_TITLE,
  classifyUnexpectedResponse,
  runCoreActionsSmoke,
  type CoreActionsFixture,
} from "../src/lib/productionSmoke/coreActions";
import {
  decideCoreSmokeAccess,
  isProductionCoreSmokeRequest,
} from "../src/lib/productionSmoke/access";
import {
  CoreSmokeLockUnavailableError,
  withCoreSmokeLock,
  type CoreSmokeRedisClient,
} from "../src/lib/productionSmoke/lock";

const fixture: CoreActionsFixture = {
  projectId: 71,
  taskId: 81,
  baseSectionId: 91,
  altSectionId: 92,
  userId: 6,
  userDisplayName: "Smoke User",
  agentId: "00000000-0000-4000-8000-000000000001",
  agentDisplayName: CORE_SMOKE_AGENT_NAME,
};

test("the operations route admits only a user token with the exact fixture", () => {
  const user = { user: { id: fixture.userId }, agentId: null };

  assert.deepEqual(decideCoreSmokeAccess(null, true), {
    ok: false,
    status: 401,
    error: "Unauthorized",
  });
  const agent = decideCoreSmokeAccess(
    { ...user, agentId: fixture.agentId },
    true,
  );
  assert.equal(agent.ok ? null : agent.status, 403);
  const emptyAgent = decideCoreSmokeAccess({ ...user, agentId: "" }, true);
  assert.equal(emptyAgent.ok ? null : emptyAgent.status, 403);
  const mismatch = decideCoreSmokeAccess(user, false);
  assert.equal(mismatch.ok ? null : mismatch.status, 409);
  assert.equal(decideCoreSmokeAccess(user, true).ok, true);
});

test("the operations route refuses preview and malformed origins", () => {
  assert.equal(
    isProductionCoreSmokeRequest(
      "https://app.hypertask.ai/api/ops/core-actions-smoke",
    ),
    true,
  );
  assert.equal(
    isProductionCoreSmokeRequest(
      "https://preview.example/api/ops/core-actions-smoke",
    ),
    false,
  );
  assert.equal(isProductionCoreSmokeRequest("not a URL"), false);
});

test("classifies an invalid smoke origin as unrunnable", async () => {
  const result = await runCoreActionsSmoke({
    baseUrl: "not a URL",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-invalid-origin",
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "unrunnable");
  assert.equal(result.action, "configure smoke origin");
});

test("rejects a run ID that stale-marker cleanup cannot parse", async () => {
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "invalid run id",
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "unrunnable");
  assert.equal(result.action, "configure smoke run");
});

test("only structured application 500s can request rollback", () => {
  assert.equal(
    classifyUnexpectedResponse(500, { message: "route failed" }),
    "application",
  );
  assert.equal(classifyUnexpectedResponse(500, null), "unrunnable");
  assert.equal(
    classifyUnexpectedResponse(503, { message: "gateway failed" }),
    "unrunnable",
  );
  assert.equal(
    classifyUnexpectedResponse(429, { message: "rate limited" }),
    "unrunnable",
  );
});

test("the fixture lock retries, runs once, and releases its own lease", async () => {
  let now = 0;
  let attempts = 0;
  let releases = 0;
  const redis: CoreSmokeRedisClient = {
    async set() {
      attempts += 1;
      return attempts === 1 ? null : "OK";
    },
    async eval() {
      releases += 1;
      return 1;
    },
  };

  const value = await withCoreSmokeLock("71:81", async () => "ran", {
    redis,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
    acquireTimeoutMs: 500,
  });

  assert.equal(value, "ran");
  assert.equal(attempts, 2);
  assert.equal(releases, 1);
});

test("the fixture lock renews its token while work remains active", async () => {
  let renewals = 0;
  let releases = 0;
  const redis: CoreSmokeRedisClient = {
    async set() {
      return "OK";
    },
    async eval(_script, _keyCount, _key, _token, ttlMilliseconds) {
      if (ttlMilliseconds) renewals += 1;
      else releases += 1;
      return 1;
    },
  };

  await withCoreSmokeLock(
    "71:81",
    () => new Promise((resolve) => setTimeout(resolve, 12)),
    { redis, renewIntervalMs: 2 },
  );

  assert.ok(renewals > 0);
  assert.equal(releases, 1);
});

test("the fixture lock rejects a run when release no longer owns the lease", async () => {
  const redis: CoreSmokeRedisClient = {
    async set() {
      return "OK";
    },
    async eval() {
      return 0;
    },
  };

  await assert.rejects(
    withCoreSmokeLock("71:81", async () => "ran", { redis }),
    CoreSmokeLockUnavailableError,
  );
});

test("the fixture lock preserves a falsy error thrown by the run", async () => {
  const redis: CoreSmokeRedisClient = {
    async set() {
      return "OK";
    },
    async eval() {
      return 1;
    },
  };
  let outcome = "resolved";

  try {
    await withCoreSmokeLock(
      "71:81",
      async () => {
        throw undefined;
      },
      { redis },
    );
  } catch (error) {
    outcome = error === undefined ? "rejected undefined" : "rejected other";
  }

  assert.equal(outcome, "rejected undefined");
});

test("the fixture lock aborts work when lease renewal loses ownership", async () => {
  let releases = 0;
  const redis: CoreSmokeRedisClient = {
    async set() {
      return "OK";
    },
    async eval(_script, _keyCount, _key, _token, ttlMilliseconds) {
      if (ttlMilliseconds) return 0;
      releases += 1;
      return 1;
    },
  };

  await assert.rejects(
    withCoreSmokeLock(
      "71:81",
      (signal) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("lock loss did not abort the run")),
            100,
          );
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve("aborted");
            },
            { once: true },
          );
        }),
      { redis, renewIntervalMs: 2 },
    ),
    CoreSmokeLockUnavailableError,
  );
  assert.equal(releases, 0);
});

test("the fixture lock aborts work at its safe deadline", async () => {
  let releases = 0;
  const redis: CoreSmokeRedisClient = {
    async set() {
      return "OK";
    },
    async eval() {
      releases += 1;
      return 1;
    },
  };

  await assert.rejects(
    withCoreSmokeLock(
      "71:81",
      (signal) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("safe deadline did not abort the run")),
            100,
          );
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve("aborted");
            },
            { once: true },
          );
        }),
      { redis, runTimeoutMs: 2 },
    ),
    CoreSmokeLockUnavailableError,
  );
  assert.equal(releases, 1);
});

test("the fixture lock refuses a second run after its wait limit", async () => {
  let now = 0;
  let slept = 0;
  const redis: CoreSmokeRedisClient = {
    async set() {
      return null;
    },
    async eval() {
      return 0;
    },
  };

  await assert.rejects(
    withCoreSmokeLock("71:81", async () => "must not run", {
      redis,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
        slept += milliseconds;
      },
      acquireTimeoutMs: 250,
    }),
    CoreSmokeLockUnavailableError,
  );
  assert.equal(slept, 250);
});

test("the fixture lock turns Redis acquisition errors into a stable failure", async () => {
  const redis: CoreSmokeRedisClient = {
    async set() {
      throw new Error("socket details that must not escape");
    },
    async eval() {
      return 0;
    },
  };

  await assert.rejects(
    withCoreSmokeLock("71:81", async () => "must not run", { redis }),
    (error) =>
      error instanceof CoreSmokeLockUnavailableError &&
      error.message ===
        "The core-action check could not acquire its fixture lock",
  );
});

function fakeApp(
  options: {
    challengeBoard?: boolean;
    failBoardBodyRead?: boolean;
    failDelete?: boolean;
    failOpenTask?: boolean;
    failRankRestore?: boolean;
    failSearch?: boolean;
    failColumns?: boolean;
    emptyColumns?: boolean;
    failUpdate?: boolean;
    loseCommentResponse?: boolean;
    omitCommentId?: boolean;
    otherSmokeMarkerAfter?: boolean;
    unrelatedAfterMarker?: boolean;
    rejectBoard?: boolean;
  } = {},
) {
  let commentResponseLost = false;
  const state = {
    sectionId: fixture.baseSectionId,
    section: "Baseline",
    ranking: "rank-original",
    assignees: [
      { agentId: fixture.agentId as string | null, userId: fixture.userId },
    ],
    comments: [] as Array<{
      id: number;
      text: string;
      activity?: object;
      creatorId?: number;
    }>,
    nextCommentId: 100,
    taskReads: 0,
  };

  const taskBody = () => ({
    id: fixture.taskId,
    projectId: fixture.projectId,
    userId: fixture.userId,
    title: CORE_SMOKE_TASK_TITLE,
    sectionId: state.sectionId,
    section: state.section,
    ranking: state.ranking,
    assignees: state.assignees,
  });

  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.pathname === "/api/projects/boardTasks") {
      if (options.failBoardBodyRead) {
        const response = Response.json({});
        response.text = async () => {
          throw new Error("response stream ended");
        };
        return response;
      }
      if (options.challengeBoard) {
        return new Response("challenge", {
          status: 403,
          headers: { "x-vercel-mitigated": "challenge" },
        });
      }
      if (options.rejectBoard) return json({ message: "Unauthorized" }, 401);
      return json({
        project: { id: fixture.projectId },
        tasks: [taskBody()],
        allViews: [],
      });
    }
    if (url.pathname === "/api/tasks/single") {
      state.taskReads += 1;
      if (options.failOpenTask && state.taskReads === 3)
        return json({ message: "Internal server error" }, 500);
      const { assignees: _assignees, ...taskWithoutAssignees } = taskBody();
      return json(taskWithoutAssignees);
    }
    if (url.pathname === "/api/comments/getByTask") {
      return json({
        comments: state.comments,
        lastReadAt: null,
        agentRunActivities: [],
      });
    }
    if (url.pathname === "/api/comments/create") {
      const comment = {
        id: state.nextCommentId++,
        text: body.text,
        creatorId: body.creatorId,
      };
      state.comments.push(comment);
      if (options.unrelatedAfterMarker) {
        state.comments.push({
          id: state.nextCommentId++,
          text: "A separate note",
        });
      }
      if (options.otherSmokeMarkerAfter) {
        state.comments.push({
          id: state.nextCommentId++,
          text: "<p>[core-actions-smoke:other-run] separate marker</p>",
          creatorId: fixture.userId,
        });
      }
      if (options.loseCommentResponse && !commentResponseLost) {
        commentResponseLost = true;
        throw new Error("connection closed after write");
      }
      return json(options.omitCommentId ? { text: comment.text } : comment);
    }
    if (url.pathname === "/api/comments/updateComment") {
      if (options.failUpdate)
        return json({ message: "update unavailable" }, 500);
      const comment = state.comments.find((item) => item.id === body.commentId);
      if (!comment) return json({ message: "comment missing" }, 404);
      comment.text = body.text;
      return json(comment);
    }
    if (url.pathname === "/api/comments/deleteCommentById") {
      if (options.failDelete)
        return json({ message: "delete unavailable" }, 500);
      state.comments = state.comments.filter(
        (comment) => comment.id !== body.id,
      );
      return json({ message: "Comment deleted" });
    }
    if (url.pathname === "/api/tasks/moveTask") {
      state.sectionId = body.sectionId;
      state.section = body.section_title;
      if (options.failRankRestore && body.sectionId === fixture.altSectionId) {
        state.ranking = "rank-mutated";
      } else if (body.ranking && !options.failRankRestore) {
        state.ranking = body.ranking;
      }
      const newComment = {
        id: state.nextCommentId++,
        text: "",
        activity: {
          type: "TaskMove",
          data: {
            fromUserId: fixture.userId,
            fromSection: {
              sectionId:
                body.sectionId === fixture.baseSectionId
                  ? fixture.altSectionId
                  : fixture.baseSectionId,
            },
            toSection: { sectionId: body.sectionId },
          },
        },
      };
      state.comments.push(newComment);
      return json({ ...taskBody(), newComment });
    }
    if (url.pathname === "/api/assignees/assign") {
      if (body.intent === "assign") {
        state.assignees.push({ agentId: null, userId: fixture.userId });
      } else {
        state.assignees = state.assignees.filter(
          (row) => row.agentId || row.userId !== fixture.userId,
        );
      }
      state.comments.push({
        id: state.nextCommentId++,
        text: "",
        activity: {
          type: "TaskAssigned",
          data: {
            fromUserId: fixture.userId,
            toUser: { userId: fixture.userId },
            updatedStatus: body.intent === "assign" ? "Assigned" : "Unassigned",
          },
        },
      });
      return json({
        body: state.assignees,
        assignStatus: body.intent === "assign" ? "Assigned" : "Unassigned",
      });
    }
    if (url.pathname === "/api/section/getProjectSections") {
      if (options.failColumns)
        return json({ error: "Cannot read properties of null" }, 500);
      if (options.emptyColumns) return json([]);
      return json([
        {
          id: fixture.baseSectionId,
          section_title: "Baseline",
          visibility: true,
        },
        {
          id: fixture.altSectionId,
          section_title: "Alternate",
          visibility: true,
        },
      ]);
    }
    if (url.pathname === "/api/search/document") {
      if (options.failSearch)
        return json({ message: "search unavailable" }, 500);
      return json({
        processedData: { All: [{ taskId: fixture.taskId }] },
        tabs: ["All"],
        status: 200,
      });
    }
    return json({ message: `Unhandled ${url.pathname}` }, 500);
  };

  return { state, fetchImpl };
}

test("runs every core action and restores the fixture", async () => {
  const app = fakeApp();
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-pass",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.steps, [
    "open board",
    "open task",
    "load comments",
    "post comment and mention user and agent",
    "load move-to-column columns",
    "move task",
    "assign and unassign",
    "search",
  ]);
  assert.equal(app.state.sectionId, fixture.baseSectionId);
  assert.equal(app.state.ranking, "rank-original");
  assert.equal(
    app.state.assignees.some((row) => !row.agentId),
    false,
  );
  assert.deepEqual(app.state.comments, []);
});

test("an ephemeral fixture does not require ownership persistence", async () => {
  const app = fakeApp({ failUpdate: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-ephemeral",
    fetchImpl: app.fetchImpl,
    persistOwnership: false,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(app.state.comments, []);
});

test("reports the task-detail regression as the open-task action", async () => {
  const app = fakeApp({ failOpenTask: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-open-task-failure",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "application");
  assert.equal(result.action, "open task");
  assert.equal(result.status, 500);
});

test("reports a crashed move-to-column route as the columns action", async () => {
  const app = fakeApp({ failColumns: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-columns-crash",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "application");
  assert.equal(result.action, "load move-to-column columns");
  assert.equal(result.status, 500);
  assert.equal(app.state.sectionId, fixture.baseSectionId);
  assert.deepEqual(app.state.comments, []);
});

test("reports an empty move-to-column list as the columns action", async () => {
  const app = fakeApp({ emptyColumns: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-columns-empty",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "application");
  assert.equal(result.action, "load move-to-column columns");
  assert.match(result.detail, /column list was empty/);
  assert.equal(app.state.sectionId, fixture.baseSectionId);
});

test("restores all visible state after a failure that follows mutations", async () => {
  const app = fakeApp({ failSearch: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-late-failure",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.action, "search");
  assert.equal(app.state.sectionId, fixture.baseSectionId);
  assert.equal(app.state.ranking, "rank-original");
  assert.equal(
    app.state.assignees.some((row) => !row.agentId),
    false,
  );
  assert.deepEqual(app.state.comments, []);
});

test("classifies a rejected test session as unrunnable and never mutates", async () => {
  const app = fakeApp({ rejectBoard: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=expired; nookies_user=user",
    fixture,
    runId: "run-auth-failure",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "unrunnable");
  assert.equal(result.action, "open board");
  assert.equal(app.state.sectionId, fixture.baseSectionId);
  assert.deepEqual(app.state.comments, []);
});

test("repairs an interrupted prior run before starting a new one", async () => {
  const app = fakeApp();
  app.state.sectionId = fixture.altSectionId;
  app.state.section = "Alternate";
  app.state.assignees.push({ agentId: null, userId: fixture.userId });
  app.state.comments.push({
    id: 50,
    text: "<p>[core-actions-smoke:stale] interrupted</p>",
    creatorId: fixture.userId,
  });
  app.state.comments.push({
    id: 51,
    text: "",
    activity: {
      type: "TaskMove",
      data: {
        fromUserId: fixture.userId,
        fromSection: { sectionId: fixture.baseSectionId },
        toSection: { sectionId: fixture.altSectionId },
      },
    },
  });

  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-after-interruption",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(app.state.sectionId, fixture.baseSectionId);
  assert.equal(
    app.state.assignees.some((row) => !row.agentId),
    false,
  );
  assert.deepEqual(app.state.comments, []);
});

test("does not overwrite non-baseline fixture state without an owned marker", async () => {
  const app = fakeApp();
  app.state.sectionId = fixture.altSectionId;
  app.state.section = "Alternate";

  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-foreign-state",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "unrunnable");
  assert.equal(result.action, "fixture baseline");
  assert.equal(app.state.sectionId, fixture.altSectionId);
});

test("treats a platform challenge as unrunnable", async () => {
  const app = fakeApp({ challengeBoard: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-challenged",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "unrunnable");
  assert.equal(result.action, "open board");
});

test("treats a response-body transport failure as unrunnable", async () => {
  const app = fakeApp({ failBoardBodyRead: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-body-read-failure",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "unrunnable");
  assert.equal(result.action, "open board");
});

test("discovers and deletes a comment whose response was lost after the write", async () => {
  const app = fakeApp({ loseCommentResponse: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-lost-response",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "unrunnable");
  assert.equal(result.action, "post comment and mentions");
  assert.deepEqual(app.state.comments, []);
});

test("deletes a created comment when its response omits the id", async () => {
  const app = fakeApp({ omitCommentId: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-missing-comment-id",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "application");
  assert.equal(result.action, "post comment and mentions");
  assert.deepEqual(app.state.comments, []);
});

test("cleanup preserves a comment that does not belong to the smoke run", async () => {
  const app = fakeApp({ unrelatedAfterMarker: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-with-unrelated-comment",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(app.state.comments, [{ id: 101, text: "A separate note" }]);
});

test("cleanup preserves a different exact smoke marker", async () => {
  const app = fakeApp({ otherSmokeMarkerAfter: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-exact-marker",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    app.state.comments.map((comment) => comment.text),
    ["<p>[core-actions-smoke:other-run] separate marker</p>"],
  );
});

test("cleanup preserves another user's comment even when it copies the marker", async () => {
  const app = fakeApp({ unrelatedAfterMarker: true });
  app.state.comments.push({
    id: 99,
    text: "[core-actions-smoke:not-ours] copied text",
    creatorId: 999,
  });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-with-copied-marker",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.ok(app.state.comments.some((comment) => comment.creatorId === 999));
});

test("reports cleanup failure as the action that needs intervention", async () => {
  const app = fakeApp({ failDelete: true, failSearch: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-cleanup-failure",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "application");
  assert.equal(result.action, "search");
  assert.match(result.detail, /cleanup failed at cleanup comment delete/);
  assert.ok(app.state.comments.length > 0);
});

test("reports a rank that cleanup could not restore", async () => {
  const app = fakeApp({ failRankRestore: true });
  const result = await runCoreActionsSmoke({
    baseUrl: "https://app.hypertask.ai",
    cookieHeader: "ht_session=signed; nookies_user=user",
    fixture,
    runId: "run-rank-restore-failure",
    fetchImpl: app.fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.action, "cleanup verify");
  assert.equal(app.state.ranking, "rank-mutated");
});
