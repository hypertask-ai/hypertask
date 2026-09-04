const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const fs = require("node:fs");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const {
  BOARD_READINESS_MARKS,
  buildBoardReadinessProperties,
  completeBoardReadinessTrace,
  emitBoardReadinessAfterPaint,
  getBoardReadinessTraceScope,
  markBoardReadinessPhase,
  prepareBoardReadinessTrace,
} = jiti(path.join(root, "src/lib/analytics/boardReadinessPhases.ts"));

const installRuntime = (hostname = "app.hypertask.ai") => {
  const previousWindow = global.window;
  const previousPerformance = global.performance;
  const entries = new Map();
  let nextMarkTime = 1;
  let nextTimerId = 1;
  const timerCallbacks = new Map();
  const clearedTimers = new Set();
  const fakePerformance = {
    getEntriesByName: (name) =>
      entries.has(name)
        ? [{ name, entryType: "mark", startTime: entries.get(name) }]
        : [],
    mark: (name) => {
      if (!entries.has(name)) entries.set(name, nextMarkTime++);
    },
    clearMarks: (name) => entries.delete(name),
    now: () => 600,
  };
  const fakeWindow = new EventTarget();
  fakeWindow.location = { hostname };
  fakeWindow.matchMedia = () => ({ matches: true });
  fakeWindow.setTimeout = (callback) => {
    const timerId = nextTimerId++;
    timerCallbacks.set(timerId, callback);
    return timerId;
  };
  fakeWindow.clearTimeout = (timerId) => clearedTimers.add(timerId);
  fakeWindow.__hypertaskProductPerformanceQueue = [];

  global.window = fakeWindow;
  Object.defineProperty(global, "performance", {
    configurable: true,
    value: fakePerformance,
  });

  return {
    entries,
    fakeWindow,
    timerCallbacks,
    clearedTimers,
    restore: () => {
      global.window = previousWindow;
      Object.defineProperty(global, "performance", {
        configurable: true,
        value: previousPerformance,
      });
    },
  };
};

test("one trace reports comparable phase durations without content identifiers", () => {
  const runtime = installRuntime();
  try {
    const timings = {
      bootstrapStart: 100,
      authAvailable: 105,
      projectsRequestStart: 110,
      projectsRequestFinish: 410,
      boardRequestStart: 112,
      boardRequestFinish: 612,
      localReadStart: 420,
      localReadFinish: 470,
      queryPublished: 480,
      networkQueryPublished: 640,
      firstBoardCommit: 560,
      usableReady: 590,
    };
    for (const [phase, startTime] of Object.entries(timings)) {
      runtime.entries.set(BOARD_READINESS_MARKS[phase], startTime);
    }

    const properties = buildBoardReadinessProperties({
      localDatabasePilot: true,
      readinessSource: "indexeddb",
      viewSurface: "board",
    });

    assert.equal(properties.trace_complete, true);
    assert.equal(properties.projects_request_duration_ms, 300);
    assert.equal(properties.board_request_duration_ms, 500);
    assert.equal(properties.local_read_duration_ms, 50);
    assert.equal(properties.query_to_commit_ms, 80);
    assert.equal(properties.commit_to_usable_ms, 30);
    assert.equal(properties.total_ready_ms, 590);
    assert.equal(properties.device_class, "mobile");
    assert.equal(properties.app_hostname, "app.hypertask.ai");
    assert.equal(
      Object.keys(properties).some((key) => /user|task|project_id/.test(key)),
      false,
    );
  } finally {
    runtime.restore();
  }
});

test("missing phases stay explicit instead of becoming zero-duration data", () => {
  const runtime = installRuntime();
  try {
    runtime.entries.set(BOARD_READINESS_MARKS.firstBoardCommit, 500);
    runtime.entries.set(BOARD_READINESS_MARKS.usableReady, 530);
    const properties = buildBoardReadinessProperties({
      localDatabasePilot: false,
      readinessSource: "network",
      viewSurface: "table",
    });

    assert.equal(properties.trace_complete, false);
    assert.match(properties.missing_phases, /bootstrapStart/);
    assert.equal(properties.projects_request_duration_ms, null);
    assert.equal(properties.query_to_commit_ms, null);
    assert.equal(properties.commit_to_usable_ms, 30);
  } finally {
    runtime.restore();
  }
});

test("out-of-order phases invalidate the trace instead of clamping to zero", () => {
  const runtime = installRuntime();
  try {
    const timings = {
      bootstrapStart: 100,
      authAvailable: 105,
      projectsRequestStart: 410,
      projectsRequestFinish: 110,
      boardRequestStart: 112,
      boardRequestFinish: 612,
      queryPublished: 580,
      firstBoardCommit: 560,
      usableReady: 590,
    };
    for (const [phase, startTime] of Object.entries(timings)) {
      runtime.entries.set(BOARD_READINESS_MARKS[phase], startTime);
    }

    const properties = buildBoardReadinessProperties({
      localDatabasePilot: false,
      readinessSource: "network",
      viewSurface: "board",
    });

    assert.equal(properties.trace_complete, false);
    assert.equal(properties.trace_order_valid, false);
    assert.match(
      properties.invalid_phase_order,
      /projectsSelectedStart>projectsRequestFinish/,
    );
    assert.match(
      properties.invalid_phase_order,
      /queryPublished>firstBoardCommit/,
    );
    assert.equal(properties.projects_request_duration_ms, null);
    assert.equal(properties.query_to_commit_ms, null);
  } finally {
    runtime.restore();
  }
});

test("client fallback duration excludes the failed parser attempt", () => {
  const runtime = installRuntime();
  try {
    const timings = {
      bootstrapStart: 100,
      authAvailable: 105,
      projectsRequestStart: 110,
      projectsFallbackStart: 410,
      projectsRequestFinish: 510,
      boardRequestStart: 112,
      boardFallbackStart: 612,
      boardRequestFinish: 762,
      queryPublished: 780,
      firstBoardCommit: 800,
      usableReady: 830,
    };
    for (const [phase, startTime] of Object.entries(timings)) {
      runtime.entries.set(BOARD_READINESS_MARKS[phase], startTime);
    }

    const properties = buildBoardReadinessProperties({
      localDatabasePilot: false,
      readinessSource: "network",
      viewSurface: "board",
    });

    assert.equal(properties.projects_request_attempt, "client");
    assert.equal(properties.projects_request_duration_ms, 100);
    assert.equal(properties.board_request_attempt, "client");
    assert.equal(properties.board_request_duration_ms, 150);
  } finally {
    runtime.restore();
  }
});

test("network publication is marked at the React Query observer boundary", () => {
  const landingSource = fs.readFileSync(
    path.join(root, "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );
  const apiSource = fs.readFileSync(
    path.join(root, "src/utils/api/Homepage/index.ts"),
    "utf8",
  );

  assert.match(
    landingSource,
    /if \(networkQueryPublished\) \{\s*markBoardNetworkQueryPublished\(readinessTraceScope\)/,
  );
  assert.doesNotMatch(apiSource, /markBoardNetworkQueryPublished/);
});

test("first-commit metadata is frozen across network reconciliation", () => {
  const landingSource = fs.readFileSync(
    path.join(root, "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );

  assert.match(
    landingSource,
    /readinessCompletionRef = useRef\(\{[\s\S]*readinessSource: _readinessSource/,
  );
  assert.match(
    landingSource,
    /const readinessCompletion = readinessCompletionRef\.current;[\s\S]*completeBoardReadinessTrace\([\s\S]*readinessCompletion,[\s\S]*boardReadinessTraceScope/,
  );
  assert.match(
    landingSource,
    /markBoardReadinessPhase\("firstBoardCommit", boardReadinessTraceScope\)[\s\S]*?boardReadinessTraceScope,[\s\S]*?readinessEntryKey,[\s\S]*?releaseSecondaryStartup/,
  );
});

test("route trace activation only mutates telemetry after React commits", () => {
  const landingSource = fs.readFileSync(
    path.join(root, "src/app/[...boardURL]/LandingPage.tsx"),
    "utf8",
  );

  assert.match(
    landingSource,
    /const useCommittedBoardReadinessTrace =[\s\S]*useLayoutEffect\(\(\) => \{[\s\S]*prepareBoardReadinessTrace\(\{ accountId, projectId, routeEntryId \}\)/,
  );
  assert.match(
    landingSource,
    /const readinessTraceScope = useCommittedBoardReadinessTrace\(\{/,
  );
  assert.match(
    landingSource,
    /const boardReadinessTraceScope = useCommittedBoardReadinessTrace\(\{/,
  );
  assert.doesNotMatch(
    landingSource,
    /if \(requestedProjectId !== null\) \{[\s\S]{0,300}prepareBoardReadinessTrace/,
  );
});

test("authenticated production readiness emits once after usable paint", () => {
  const runtime = installRuntime();
  try {
    runtime.entries.set(BOARD_READINESS_MARKS.networkQueryPublished, 400);
    runtime.entries.set(BOARD_READINESS_MARKS.queryPublished, 400);
    runtime.entries.set(BOARD_READINESS_MARKS.firstBoardCommit, 500);

    const completion = {
      accountId: 6,
      projectId: 15,
      authenticated: true,
      localDatabasePilot: true,
      readinessSource: "network",
      viewSurface: "board",
    };
    completeBoardReadinessTrace(completion);
    completeBoardReadinessTrace(completion);

    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 1);
    assert.equal(
      runtime.fakeWindow.__hypertaskProductPerformanceQueue[0].event,
      "app_board_readiness_phases",
    );
    assert.ok(runtime.entries.has(BOARD_READINESS_MARKS.usableReady));
  } finally {
    runtime.restore();
  }
});

test("board readiness version 3 records the painted snapshot once", () => {
  const runtime = installRuntime();
  try {
    prepareBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      routeEntryId: 1,
    });
    const scope = getBoardReadinessTraceScope();
    runtime.entries.set(BOARD_READINESS_MARKS.localReadStart, 200);
    const completion = {
      accountId: 6,
      projectId: 15,
      authenticated: true,
      localDatabasePilot: true,
      readinessSource: "indexeddb",
      viewSurface: "board",
    };

    assert.equal(emitBoardReadinessAfterPaint(completion, scope), true);
    assert.equal(emitBoardReadinessAfterPaint(completion, scope), false);
    const event = runtime.fakeWindow.__hypertaskProductPerformanceQueue[0];
    assert.equal(event.event, "app_board_readiness");
    assert.equal(event.properties.readiness_measurement_version, 3);
    assert.equal(event.properties.readiness_source, "indexeddb");
    assert.equal(event.properties.duration_ms, 400);
  } finally {
    runtime.restore();
  }
});

test("browser marks remain but previews do not enter production telemetry", () => {
  const runtime = installRuntime("preview.example.vercel.app");
  try {
    runtime.entries.set(BOARD_READINESS_MARKS.networkQueryPublished, 400);
    completeBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      authenticated: true,
      localDatabasePilot: true,
      readinessSource: "network",
      viewSurface: "board",
    });

    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 0);
    assert.ok(runtime.entries.has(BOARD_READINESS_MARKS.usableReady));
  } finally {
    runtime.restore();
  }
});

test("account and project changes reject stale completion and start a fresh trace", () => {
  const runtime = installRuntime();
  try {
    prepareBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      routeEntryId: 1,
    });
    runtime.entries.set(BOARD_READINESS_MARKS.queryPublished, 250);
    runtime.entries.set(BOARD_READINESS_MARKS.firstBoardCommit, 300);

    completeBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      authenticated: true,
      localDatabasePilot: true,
      readinessSource: "indexeddb",
      viewSurface: "board",
    });
    assert.notEqual(
      runtime.fakeWindow.__htBoardReadinessRuntime.fallbackTimer,
      undefined,
    );

    prepareBoardReadinessTrace({
      accountId: 7,
      projectId: 16,
      routeEntryId: 2,
    });
    assert.deepEqual(runtime.fakeWindow.__htBoardReadinessRuntime, {
      accountId: 7,
      projectId: 16,
      routeEntryId: 2,
      generation: 1,
    });
    assert.equal(runtime.entries.size, 0);

    completeBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      authenticated: true,
      localDatabasePilot: true,
      readinessSource: "indexeddb",
      viewSurface: "board",
    });
    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 0);

    runtime.entries.set(BOARD_READINESS_MARKS.networkQueryPublished, 400);
    completeBoardReadinessTrace({
      accountId: 7,
      projectId: 16,
      authenticated: true,
      localDatabasePilot: false,
      readinessSource: "network",
      viewSurface: "table",
    });

    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 1);
    assert.equal(
      runtime.fakeWindow.__hypertaskProductPerformanceQueue[0]
        .__hypertaskAccountId,
      7,
    );
    assert.equal(
      Object.hasOwn(
        runtime.fakeWindow.__hypertaskProductPerformanceQueue[0].properties,
        "projectId",
      ),
      false,
    );
  } finally {
    runtime.restore();
  }
});

test("a cleared fallback callback cannot force-emit a later trace", () => {
  const runtime = installRuntime();
  try {
    prepareBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      routeEntryId: 1,
    });
    completeBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      authenticated: true,
      localDatabasePilot: true,
      readinessSource: "indexeddb",
      viewSurface: "board",
    });
    const staleTimerId =
      runtime.fakeWindow.__htBoardReadinessRuntime.fallbackTimer;
    const staleCallback = runtime.timerCallbacks.get(staleTimerId);

    prepareBoardReadinessTrace({
      accountId: 7,
      projectId: 16,
      routeEntryId: 2,
    });
    assert.equal(runtime.clearedTimers.has(staleTimerId), true);
    completeBoardReadinessTrace({
      accountId: 7,
      projectId: 16,
      authenticated: true,
      localDatabasePilot: false,
      readinessSource: "network",
      viewSurface: "table",
    });
    const currentTimerId =
      runtime.fakeWindow.__htBoardReadinessRuntime.fallbackTimer;
    const currentCallback = runtime.timerCallbacks.get(currentTimerId);

    staleCallback();
    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 0);

    currentCallback();
    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 1);
    assert.equal(
      runtime.fakeWindow.__hypertaskProductPerformanceQueue[0]
        .__hypertaskAccountId,
      7,
    );
  } finally {
    runtime.restore();
  }
});

test("trace generation rejects a stale callback after returning to the same entry", () => {
  const runtime = installRuntime();
  const completion = {
    accountId: 6,
    projectId: 15,
    authenticated: true,
    localDatabasePilot: true,
    readinessSource: "indexeddb",
    viewSurface: "board",
  };
  try {
    prepareBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      routeEntryId: 1,
    });
    completeBoardReadinessTrace(completion);
    const firstTimerId =
      runtime.fakeWindow.__htBoardReadinessRuntime.fallbackTimer;
    const firstCallback = runtime.timerCallbacks.get(firstTimerId);

    prepareBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      routeEntryId: 2,
    });
    completeBoardReadinessTrace(completion);
    const currentTimerId =
      runtime.fakeWindow.__htBoardReadinessRuntime.fallbackTimer;

    assert.equal(runtime.fakeWindow.__htBoardReadinessRuntime.generation, 1);
    firstCallback();
    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 0);

    runtime.timerCallbacks.get(currentTimerId)();
    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 1);
  } finally {
    runtime.restore();
  }
});

test("late async marks cannot enter a newer same-board route trace", () => {
  const runtime = installRuntime();
  try {
    prepareBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      routeEntryId: 1,
    });
    const staleScope = getBoardReadinessTraceScope();
    markBoardReadinessPhase("boardRequestStart", staleScope);

    prepareBoardReadinessTrace({
      accountId: 6,
      projectId: 15,
      routeEntryId: 2,
    });
    const currentScope = getBoardReadinessTraceScope();
    markBoardReadinessPhase("boardRequestFinish", staleScope);
    markBoardReadinessPhase("boardRequestStart", currentScope);

    assert.equal(
      runtime.entries.has(BOARD_READINESS_MARKS.boardRequestFinish),
      false,
    );
    assert.equal(
      runtime.entries.has(BOARD_READINESS_MARKS.boardRequestStart),
      true,
    );
    assert.equal(runtime.fakeWindow.__htBoardReadinessRuntime.generation, 1);
  } finally {
    runtime.restore();
  }
});

// HTPR-6072: the board tree no longer remounts on a switch (SectionComp
// dropped its key={readinessRouteEntryId}), so this generation-based reset
// is now the only thing keeping readiness "once per project-route entry" -
// the guarantee PR #2765 / HTPR-5432 introduced the remount for in the first
// place. Pin that a switch still gets a fresh trace and a same-entry
// re-publication (focus regaining the board, a realtime reconnect) still
// only emits once.
test("HTPR-6072: readiness emits once per entry across a switch and a same-entry re-publication", () => {
  const runtime = installRuntime();
  try {
    prepareBoardReadinessTrace({ accountId: 6, projectId: 15, routeEntryId: 1 });
    runtime.entries.set(BOARD_READINESS_MARKS.networkQueryPublished, 100);
    completeBoardReadinessTrace(
      {
        accountId: 6,
        projectId: 15,
        authenticated: true,
        localDatabasePilot: true,
        readinessSource: "indexeddb",
        viewSurface: "board",
      },
      getBoardReadinessTraceScope(),
    );
    assert.equal(runtime.fakeWindow.__hypertaskProductPerformanceQueue.length, 1);

    // A focus/reconnect event re-publishes for the SAME entry: no fresh
    // trace, no second emit.
    prepareBoardReadinessTrace({ accountId: 6, projectId: 15, routeEntryId: 1 });
    completeBoardReadinessTrace(
      {
        accountId: 6,
        projectId: 15,
        authenticated: true,
        localDatabasePilot: true,
        readinessSource: "indexeddb",
        viewSurface: "board",
      },
      getBoardReadinessTraceScope(),
    );
    assert.equal(
      runtime.fakeWindow.__hypertaskProductPerformanceQueue.length,
      1,
      "a same-entry re-publication must not emit a second event",
    );

    // A real switch: new routeEntryId, fresh trace, its own emit.
    prepareBoardReadinessTrace({ accountId: 6, projectId: 16, routeEntryId: 2 });
    runtime.entries.set(BOARD_READINESS_MARKS.networkQueryPublished, 200);
    completeBoardReadinessTrace(
      {
        accountId: 6,
        projectId: 16,
        authenticated: true,
        localDatabasePilot: true,
        readinessSource: "indexeddb",
        viewSurface: "board",
      },
      getBoardReadinessTraceScope(),
    );
    assert.equal(
      runtime.fakeWindow.__hypertaskProductPerformanceQueue.length,
      2,
      "a real switch to a new route entry must emit its own event",
    );
  } finally {
    runtime.restore();
  }
});
