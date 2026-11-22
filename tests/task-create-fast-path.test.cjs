const assert = require("node:assert/strict");
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

function memoryBoard({ tasks = [], aliases = [], issued = 0 } = {}) {
  const state = {
    tasks: [...tasks],
    aliases: [...aliases],
    issued,
  };
  const highest = (values) => values.reduce((max, value) => Math.max(max, value), null);
  return {
    state,
    removeTask(uniqueIndex) {
      state.tasks = state.tasks.filter((value) => value !== uniqueIndex);
    },
    db: {
      task: {
        aggregate: async () => ({ _max: { uniqueIndex: highest(state.tasks) } }),
      },
      taskNumberAlias: {
        aggregate: async () => ({ _max: { uniqueIndex: highest(state.aliases) } }),
      },
      project: {
        findUnique: async () => ({ issuedUniqueIndex: state.issued }),
        updateMany: async ({ where, data }) => {
          if (!(state.issued < where.issuedUniqueIndex.lt)) return { count: 0 };
          state.issued = data.issuedUniqueIndex;
          return { count: 1 };
        },
      },
    },
  };
}

test("task index allocation starts an empty project at one", async () => {
  const board = memoryBoard();
  assert.equal(await getNextUniqueTaskIndex(15, board.db), 1);
  assert.equal(board.state.issued, 1);
});

test("task index allocation continues past the highest surviving task", async () => {
  const board = memoryBoard({ tasks: [1, 3, 41] });
  assert.equal(await getNextUniqueTaskIndex(15, board.db), 42);
  assert.equal(board.state.issued, 42);
});

test("a task made after the highest number is deleted gets a new number", async () => {
  const board = memoryBoard({ tasks: [6284, 6285, 6286], issued: 6286 });
  board.removeTask(6286);
  assert.equal(await getNextUniqueTaskIndex(15, board.db), 6287);
  assert.equal(await getNextUniqueTaskIndex(15, board.db), 6288);
  assert.equal(board.state.issued, 6288);
});

test("a moved-away task number is not issued again", async () => {
  const board = memoryBoard({ tasks: [1, 41], aliases: [50] });
  assert.equal(await getNextUniqueTaskIndex(15, board.db), 51);
});

test("two allocations at once receive different numbers", async () => {
  const board = memoryBoard({ tasks: [10], issued: 10 });
  const numbers = await Promise.all([
    getNextUniqueTaskIndex(15, board.db),
    getNextUniqueTaskIndex(15, board.db),
  ]);
  assert.deepEqual(numbers.sort((left, right) => left - right), [11, 12]);
  assert.equal(board.state.issued, 12);
});

test("task number allocation refuses a missing board", async () => {
  const db = {
    task: { aggregate: async () => ({ _max: { uniqueIndex: null } }) },
    taskNumberAlias: { aggregate: async () => ({ _max: { uniqueIndex: null } }) },
    project: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
  };
  await assert.rejects(
    () => getNextUniqueTaskIndex(15, db),
    /Board not found while allocating a task number/,
  );
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
      ai_task_writer_ms: null,
      ai_title_ms: null,
      server_validate_ms: 12.1,
      server_task_create_ms: 90.4,
      server_enrich_ms: 7.5,
      server_total_ms: 110,
      device_class: "desktop",
      project_id: 15,
      result: "success",
      response_status: 200,
      visible_completion: "task_detail",
      task_create_measurement_version: 3,
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

