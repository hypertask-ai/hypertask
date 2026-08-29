const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const { getNextUniqueTaskIndex } = jiti(
  path.join(root, "src/utils/controllers/tasks/getNextUniqueTaskIndex.ts"),
);
const {
  beginTaskCreatePerformanceTrace,
  completeTaskCreatePerformanceTrace,
  completeTaskCreatePerformanceTraceAfterElementRemoved,
  completeTaskCreatePerformanceTraceAfterPaint,
  installProductPerformanceSink,
  parseTaskCreateServerTiming,
  recordTaskCreateResponse,
} = jiti(path.join(root, "src/lib/analytics/productPerformance.ts"));

test("task index allocation uses one project-scoped max query", async () => {
  const calls = [];
  const db = {
    task: {
      aggregate: async (args) => {
        calls.push(args);
        return { _max: { uniqueIndex: 41 } };
      },
    },
  };

  assert.equal(await getNextUniqueTaskIndex(15, db), 42);
  assert.deepEqual(calls, [
    { where: { projectId: 15 }, _max: { uniqueIndex: true } },
  ]);
});

test("task index allocation starts an empty project at one", async () => {
  const db = {
    task: {
      aggregate: async () => ({ _max: { uniqueIndex: null } }),
    },
  };

  assert.equal(await getNextUniqueTaskIndex(15, db), 1);
});

test("task create server timing parses known phases and ignores invalid values", () => {
  assert.deepEqual(
    parseTaskCreateServerTiming(
      'cache;desc="miss", validate;dur=8.2, task-create;dur="11.4", enrich;dur=-1, total;dur=oops',
    ),
    {
      validate: 8.2,
      taskCreate: 11.4,
      enrich: null,
      total: null,
    },
  );
  assert.deepEqual(parseTaskCreateServerTiming(undefined), {
    validate: null,
    taskCreate: null,
    enrich: null,
    total: null,
  });
});

test("task create trace emits one complete submit-to-visible sample", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(global, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(global, "document");
  const previousPerformance = Object.getOwnPropertyDescriptor(global, "performance");
  const fakeWindow = new EventTarget();
  fakeWindow.location = { hostname: "app.hypertask.ai" };
  fakeWindow.matchMedia = () => ({ matches: false });
  let composerVisible = true;
  const frameCallbacks = [];
  fakeWindow.requestAnimationFrame = (callback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  };
  const flushFrame = () => {
    const callbacks = frameCallbacks.splice(0);
    callbacks.forEach((callback) => callback(now));
  };
  let now = 100;
  const marks = [];
  Object.defineProperty(global, "window", {
    configurable: true,
    writable: true,
    value: fakeWindow,
  });
  Object.defineProperty(global, "document", {
    configurable: true,
    writable: true,
    value: {
      getElementById: (id) =>
        id === "task-create-composer" && composerVisible ? {} : null,
    },
  });
  Object.defineProperty(global, "performance", {
    configurable: true,
    writable: true,
    value: {
      now: () => now,
      mark: (name) => marks.push(name),
    },
  });

  const captured = [];
  const uninstall = installProductPerformanceSink((event, accountId) => {
    captured.push({ event, accountId });
  });

  try {
    const concurrentScope = beginTaskCreatePerformanceTrace({
      accountId: 6,
      projectId: 15,
    });
    now = 110;
    const scope = beginTaskCreatePerformanceTrace({
      accountId: 6,
      projectId: 15,
    });
    assert.equal(
      recordTaskCreateResponse({
        accountId: 6,
        projectId: 15,
        networkDurationMs: 999,
        responseStatus: 200,
        serverTimings: parseTaskCreateServerTiming("total;dur=999"),
        result: "success",
        scope: { traceId: 999_999 },
      }),
      false,
    );
    assert.equal(
      recordTaskCreateResponse({
        accountId: 6,
        projectId: 15,
        networkDurationMs: 25,
        responseStatus: 202,
        serverTimings: parseTaskCreateServerTiming("total;dur=20"),
        result: "success",
        scope: concurrentScope,
      }),
      true,
    );

    now = 350;
    assert.equal(
      recordTaskCreateResponse({
        accountId: 6,
        projectId: 15,
        networkDurationMs: 239.6,
        responseStatus: 200,
        serverTimings: parseTaskCreateServerTiming(
          "validate;dur=12.1, task-create;dur=90.4, enrich;dur=7.5, total;dur=110",
        ),
        result: "success",
        scope,
      }),
      true,
    );
    assert.equal(
      recordTaskCreateResponse({
        accountId: 6,
        projectId: 15,
        networkDurationMs: 999,
        responseStatus: 503,
        serverTimings: parseTaskCreateServerTiming("total;dur=999"),
        result: "error",
        scope,
      }),
      false,
      "a later catch path must not overwrite the resolved response",
    );
    now = 700;
    assert.equal(completeTaskCreatePerformanceTrace("task_detail", scope), true);
    assert.equal(completeTaskCreatePerformanceTrace("task_detail", scope), false);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].accountId, 6);
    assert.deepEqual(captured[0].event.properties, {
      analytics_surface: "authenticated_app",
      app_hostname: "app.hypertask.ai",
      route_family: "task_create",
      create_surface: "global_modal",
      duration_ms: 240,
      network_duration_ms: 240,
      submit_to_visible_ms: 590,
      server_validate_ms: 12.1,
      server_task_create_ms: 90.4,
      server_enrich_ms: 7.5,
      server_total_ms: 110,
      device_class: "desktop",
      project_id: 15,
      result: "success",
      response_status: 200,
      visible_completion: "task_detail",
      task_create_measurement_version: 2,
      task_create_measurement_scope: "submit_to_visible",
    });
    assert.deepEqual(marks, [
      "ht-task-create-submit",
      "ht-task-create-submit",
      "ht-task-create-response-success",
      "ht-task-create-response-success",
      "ht-task-create-visible-task_detail",
    ]);

    now += 10;
    assert.equal(
      completeTaskCreatePerformanceTrace("composer_reset", concurrentScope),
      true,
    );
    assert.equal(captured[1].event.properties.response_status, 202);

    now += 10;
    const modalScope = beginTaskCreatePerformanceTrace({
      accountId: 6,
      projectId: 15,
    });
    recordTaskCreateResponse({
      accountId: 6,
      projectId: 15,
      networkDurationMs: 5,
      responseStatus: 200,
      serverTimings: parseTaskCreateServerTiming("total;dur=4"),
      result: "success",
      scope: modalScope,
    });
    const countBeforeClose = captured.length;
    assert.equal(
      completeTaskCreatePerformanceTraceAfterElementRemoved(
        "modal_closed",
        modalScope,
        "task-create-composer",
      ),
      true,
    );
    flushFrame();
    assert.equal(captured.length, countBeforeClose);
    composerVisible = false;
    flushFrame();
    flushFrame();
    assert.equal(captured.length, countBeforeClose);
    flushFrame();
    assert.equal(captured.length, countBeforeClose + 1);

    now += 10;
    const resetScope = beginTaskCreatePerformanceTrace({
      accountId: 6,
      projectId: 15,
    });
    recordTaskCreateResponse({
      accountId: 6,
      projectId: 15,
      networkDurationMs: 5,
      responseStatus: 200,
      serverTimings: parseTaskCreateServerTiming("total;dur=4"),
      result: "success",
      scope: resetScope,
    });
    const countBeforeReset = captured.length;
    assert.equal(
      completeTaskCreatePerformanceTraceAfterPaint("composer_reset", resetScope),
      true,
    );
    flushFrame();
    assert.equal(captured.length, countBeforeReset);
    flushFrame();
    assert.equal(captured.length, countBeforeReset + 1);
    assert.deepEqual(
      captured.slice(2).map(({ event }) => event.properties.visible_completion),
      ["modal_closed", "composer_reset"],
    );
  } finally {
    uninstall();
    if (previousWindow) Object.defineProperty(global, "window", previousWindow);
    else delete global.window;
    if (previousDocument) {
      Object.defineProperty(global, "document", previousDocument);
    } else {
      delete global.document;
    }
    if (previousPerformance) {
      Object.defineProperty(global, "performance", previousPerformance);
    } else {
      delete global.performance;
    }
  }
});

test("failed task create traces are explicitly incomplete", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(global, "window");
  const previousPerformance = Object.getOwnPropertyDescriptor(global, "performance");
  const fakeWindow = new EventTarget();
  fakeWindow.location = { hostname: "app.hypertask.ai" };
  fakeWindow.matchMedia = () => ({ matches: true });
  let now = 10;
  Object.defineProperty(global, "window", {
    configurable: true,
    writable: true,
    value: fakeWindow,
  });
  Object.defineProperty(global, "performance", {
    configurable: true,
    writable: true,
    value: { now: () => now, mark: () => undefined },
  });

  const captured = [];
  const uninstall = installProductPerformanceSink((event) => captured.push(event));
  try {
    const scope = beginTaskCreatePerformanceTrace({ accountId: 6, projectId: 15 });
    now = 75;
    recordTaskCreateResponse({
      accountId: 6,
      projectId: 15,
      networkDurationMs: 65,
      responseStatus: 500,
      serverTimings: parseTaskCreateServerTiming(undefined),
      result: "error",
      scope,
    });
    now = 90;
    assert.equal(completeTaskCreatePerformanceTrace("error", scope), true);
    assert.equal(captured[0].properties.result, "error");
    assert.equal(captured[0].properties.visible_completion, "error");
    assert.equal(captured[0].properties.submit_to_visible_ms, null);
    assert.equal(captured[0].properties.network_duration_ms, 65);
  } finally {
    uninstall();
    if (previousWindow) Object.defineProperty(global, "window", previousWindow);
    else delete global.window;
    if (previousPerformance) {
      Object.defineProperty(global, "performance", previousPerformance);
    } else {
      delete global.performance;
    }
  }
});

test("the global task route keeps noncritical work out of the response path", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/api/tasks/createGlobally.ts"),
    "utf8",
  );

  assert.match(source, /description_:\s*\{\s*create:/);
  assert.match(source, /schedulePostCreateWork\(/);
  assert.match(source, /waitUntil\(work\)/);
  assert.match(source, /"Server-Timing"/);
  assert.doesNotMatch(
    source,
    /^import .*turbopufferHelper/m,
    "search indexing must stay lazy on the basic create path",
  );
  assert.doesNotMatch(
    source,
    /^import .*labelClassifier/m,
    "AI classification must stay lazy on the basic create path",
  );
});

test("task create telemetry completes after each visible UI transition", () => {
  const controllerSource = fs.readFileSync(
    path.join(root, "src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts"),
    "utf8",
  );
  const stateSource = fs.readFileSync(
    path.join(root, "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts"),
    "utf8",
  );
  const modalSource = fs.readFileSync(
    path.join(root, "src/components/RTE/TiptapCreateTaskModal.tsx"),
    "utf8",
  );

  assert.match(
    controllerSource,
    /serverTimingHeader: response\.headers\["server-timing"\]/,
  );
  assert.match(
    stateSource,
    /beginTaskCreatePerformanceTrace\([\s\S]*?processHtmlForTaskId/,
  );
  assert.match(
    stateSource,
    /createTaskGlobally\([\s\S]*?return taskUrl/,
    "the create promise must resolve only after the optimistic update",
  );
  assert.match(
    modalSource,
    /await asyncPush\(taskUrl\);[\s\S]*?completeTaskCreatePerformanceTraceAfterPaint\(\s*"task_detail",\s*traceScope,?\s*\)/,
  );
  assert.match(
    modalSource,
    /closeHandler\(true\);\s*completeTaskCreatePerformanceTraceAfterElementRemoved\(\s*"modal_closed",\s*traceScope,\s*divIds\.wrapperId,?\s*\)/,
  );
  assert.match(
    modalSource,
    /\.focus\(\);\s*setUploadInProgress\(false\);\s*completeTaskCreatePerformanceTraceAfterPaint\(\s*"composer_reset",\s*traceScope,?\s*\)/,
  );
});

test("the global task route validates the claimed agent actor", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/api/tasks/createGlobally.ts"),
    "utf8",
  );

  assert.match(source, /agentId: requestedAgentId/);
  assert.match(source, /const session = await getSessionUser/);
  assert.match(source, /userId: requestedUserId/);
  assert.match(source, /const userId = session\.userId/);
  assert.match(source, /prisma\.user\.findUnique/);
  assert.match(source, /taskWriteAccessWhere\(userId, agentId\)/);
  assert.match(source, /getActiveAgentOwnerId\(agentId\)/);
  assert.match(source, /agentOwnerId !== session\.userId/);
  assert.match(source, /isAgentOnBoard\(Number\(projectId\), agentId\)/);
  assert.match(source, /status\(403\)\.json\(\{ message: "Forbidden" \}\)/);
});
