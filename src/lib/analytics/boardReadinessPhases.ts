import { AUTHENTICATED_APP_HOSTNAME } from "@/lib/analytics/appPerformanceScope";
import { emitProductPerformanceEvent } from "@/lib/analytics/productPerformance";

export const BOARD_READINESS_MARKS = {
  bootstrapStart: "ht-board-bootstrap-start",
  authAvailable: "ht-board-auth-available",
  projectsRequestStart: "ht-board-projects-request-start",
  projectsFallbackStart: "ht-board-projects-fallback-start",
  projectsRequestFinish: "ht-board-projects-request-finish",
  boardRequestStart: "ht-board-tasks-request-start",
  boardFallbackStart: "ht-board-tasks-fallback-start",
  boardRequestFinish: "ht-board-tasks-request-finish",
  localReadStart: "ht-board-local-read-start",
  localReadFinish: "ht-board-local-read-finish",
  queryPublished: "ht-board-query-published",
  networkQueryPublished: "ht-board-network-query-published",
  firstBoardCommit: "ht-board-first-commit",
  usableReady: "ht-board-usable-ready",
} as const;

export type BoardReadinessPhase = keyof typeof BOARD_READINESS_MARKS;
export type BoardReadinessSource = "indexeddb" | "network" | "unknown";

export type BoardReadinessCompletion = {
  accountId: number;
  projectId: number;
  authenticated: boolean;
  localDatabasePilot: boolean;
  readinessSource: BoardReadinessSource;
  viewSurface: "board" | "table";
};

type BoardReadinessRuntime = {
  accountId?: number;
  projectId?: number;
  routeEntryId?: number;
  generation?: number;
  completion?: BoardReadinessCompletion;
  emitted?: boolean;
  readinessEventEmitted?: boolean;
  fallbackTimer?: number;
};

export type BoardReadinessTraceScope = {
  accountId: number;
  projectId: number;
  routeEntryId: number;
  generation: number;
};

let boardReadinessRouteEntrySequence = 0;

export const createBoardReadinessRouteEntryId = (): number =>
  ++boardReadinessRouteEntrySequence;

declare global {
  interface Window {
    __htBoardReadinessRuntime?: BoardReadinessRuntime;
  }
}

const rounded = (value: number | undefined): number | null =>
  value === undefined ? null : Math.max(0, Math.round(value));

const duration = (
  start: number | undefined,
  finish: number | undefined,
): number | null =>
  start === undefined || finish === undefined
    ? null
    : finish < start
      ? null
      : rounded(finish - start);

const firstMarkTime = (phase: BoardReadinessPhase): number | undefined => {
  if (typeof performance === "undefined") return undefined;
  return performance.getEntriesByName(BOARD_READINESS_MARKS[phase], "mark")[0]
    ?.startTime;
};

const runtimeMatchesScope = (
  runtime: BoardReadinessRuntime,
  scope: BoardReadinessTraceScope,
): boolean =>
  runtime.accountId === scope.accountId &&
  runtime.projectId === scope.projectId &&
  runtime.routeEntryId === scope.routeEntryId &&
  runtime.generation === scope.generation;

export const getBoardReadinessTraceScope =
  (): BoardReadinessTraceScope | null => {
    if (typeof window === "undefined") return null;
    const runtime = window.__htBoardReadinessRuntime;
    if (
      runtime?.accountId === undefined ||
      runtime.projectId === undefined ||
      runtime.routeEntryId === undefined ||
      runtime.generation === undefined
    ) {
      return null;
    }
    return {
      accountId: runtime.accountId,
      projectId: runtime.projectId,
      routeEntryId: runtime.routeEntryId,
      generation: runtime.generation,
    };
  };

export const markBoardReadinessPhase = (
  phase: BoardReadinessPhase,
  expectedScope?: BoardReadinessTraceScope | null,
): void => {
  if (typeof performance === "undefined") return;
  if (expectedScope === null) return;
  if (
    expectedScope &&
    (typeof window === "undefined" ||
      !runtimeMatchesScope(
        window.__htBoardReadinessRuntime ?? {},
        expectedScope,
      ))
  ) {
    return;
  }
  const markName = BOARD_READINESS_MARKS[phase];
  if (performance.getEntriesByName(markName, "mark").length === 0) {
    performance.mark(markName);
  }
};

export const buildBoardReadinessProperties = (
  completion: Omit<
    BoardReadinessCompletion,
    "authenticated" | "accountId" | "projectId"
  >,
) => {
  const marks = Object.fromEntries(
    (Object.keys(BOARD_READINESS_MARKS) as BoardReadinessPhase[]).map(
      (phase) => [phase, firstMarkTime(phase)],
    ),
  ) as Record<BoardReadinessPhase, number | undefined>;
  const requiredPhases: BoardReadinessPhase[] = [
    "bootstrapStart",
    "authAvailable",
    "projectsRequestStart",
    "projectsRequestFinish",
    "boardRequestStart",
    "boardRequestFinish",
    "queryPublished",
    "firstBoardCommit",
    "usableReady",
  ];
  const missingPhases = requiredPhases.filter(
    (phase) => marks[phase] === undefined,
  );
  const projectsSelectedStart =
    marks.projectsFallbackStart ?? marks.projectsRequestStart;
  const boardSelectedStart =
    marks.boardFallbackStart ?? marks.boardRequestStart;
  const orderedPairs: [BoardReadinessPhase, BoardReadinessPhase][] = [
    ["bootstrapStart", "authAvailable"],
    ["authAvailable", "projectsRequestStart"],
    ["authAvailable", "boardRequestStart"],
    ["localReadStart", "localReadFinish"],
    ["queryPublished", "firstBoardCommit"],
    ["firstBoardCommit", "usableReady"],
  ];
  const invalidPhaseOrder = orderedPairs
    .filter(([start, finish]) =>
      marks[start] !== undefined &&
      marks[finish] !== undefined &&
      marks[start]! > marks[finish]!,
    )
    .map(([start, finish]) => `${start}>${finish}`);
  if (
    projectsSelectedStart !== undefined &&
    marks.projectsRequestFinish !== undefined &&
    projectsSelectedStart > marks.projectsRequestFinish
  ) {
    invalidPhaseOrder.push("projectsSelectedStart>projectsRequestFinish");
  }
  if (
    boardSelectedStart !== undefined &&
    marks.boardRequestFinish !== undefined &&
    boardSelectedStart > marks.boardRequestFinish
  ) {
    invalidPhaseOrder.push("boardSelectedStart>boardRequestFinish");
  }

  return {
    analytics_surface: "authenticated_app" as const,
    app_hostname:
      typeof window === "undefined" ? "" : window.location.hostname,
    route_family: "project" as const,
    route_path: "/project" as const,
    view_surface: completion.viewSurface,
    readiness_source: completion.readinessSource,
    device_class:
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches
        ? ("mobile" as const)
        : ("desktop" as const),
    local_database_pilot: completion.localDatabasePilot,
    production_commit: process.env.NEXT_PUBLIC_BUILD_ID || "unknown",
    trace_complete:
      missingPhases.length === 0 && invalidPhaseOrder.length === 0,
    missing_phases: missingPhases.join(","),
    trace_order_valid: invalidPhaseOrder.length === 0,
    invalid_phase_order: invalidPhaseOrder.join(","),
    bootstrap_start_ms: rounded(marks.bootstrapStart),
    auth_available_ms: rounded(marks.authAvailable),
    projects_request_start_ms: rounded(marks.projectsRequestStart),
    projects_fallback_start_ms: rounded(marks.projectsFallbackStart),
    projects_request_attempt:
      marks.projectsFallbackStart === undefined
        ? ("parser" as const)
        : ("client" as const),
    projects_request_finish_ms: rounded(marks.projectsRequestFinish),
    projects_request_duration_ms: duration(
      projectsSelectedStart,
      marks.projectsRequestFinish,
    ),
    board_request_start_ms: rounded(marks.boardRequestStart),
    board_fallback_start_ms: rounded(marks.boardFallbackStart),
    board_request_attempt:
      marks.boardFallbackStart === undefined
        ? ("parser" as const)
        : ("client" as const),
    board_request_finish_ms: rounded(marks.boardRequestFinish),
    board_request_duration_ms: duration(
      boardSelectedStart,
      marks.boardRequestFinish,
    ),
    local_read_start_ms: rounded(marks.localReadStart),
    local_read_finish_ms: rounded(marks.localReadFinish),
    local_read_duration_ms: duration(
      marks.localReadStart,
      marks.localReadFinish,
    ),
    query_published_ms: rounded(marks.queryPublished),
    network_query_published_ms: rounded(marks.networkQueryPublished),
    first_board_commit_ms: rounded(marks.firstBoardCommit),
    query_to_commit_ms: duration(
      marks.queryPublished,
      marks.firstBoardCommit,
    ),
    usable_ready_ms: rounded(marks.usableReady),
    commit_to_usable_ms: duration(
      marks.firstBoardCommit,
      marks.usableReady,
    ),
    total_ready_ms: rounded(marks.usableReady),
  };
};

const clearBoardReadinessMarks = (): void => {
  if (
    typeof performance === "undefined" ||
    typeof performance.clearMarks !== "function"
  ) {
    return;
  }
  Object.values(BOARD_READINESS_MARKS).forEach((markName) => {
    performance.clearMarks(markName);
  });
};

/**
 * Start a distinct trace for an account/project entry in this document.
 *
 * App Router navigation can reuse this module and component tree. Resetting at
 * that boundary prevents an old completion or mark set from being attributed
 * to the next account or project while preserving one trace per entry.
 */
export const prepareBoardReadinessTrace = ({
  accountId,
  projectId,
  routeEntryId,
}: {
  accountId: number;
  projectId: number;
  routeEntryId: number;
}): void => {
  if (typeof window === "undefined") return;
  const runtime = (window.__htBoardReadinessRuntime ??= {});
  const hasInFlightOrCompletedTrace =
    runtime.completion !== undefined ||
    runtime.emitted === true ||
    runtime.fallbackTimer !== undefined;
  if (
    runtime.accountId === undefined &&
    runtime.projectId === undefined &&
    !hasInFlightOrCompletedTrace
  ) {
    runtime.accountId = accountId;
    runtime.projectId = projectId;
    runtime.routeEntryId = routeEntryId;
    runtime.generation ??= 0;
    return;
  }
  if (
    runtime.accountId === accountId &&
    runtime.projectId === projectId &&
    runtime.routeEntryId === undefined &&
    !hasInFlightOrCompletedTrace
  ) {
    // Adopt parser-time marks for the initial route entry. The bootstrap
    // script cannot know React's route-entry id before hydration.
    runtime.routeEntryId = routeEntryId;
    runtime.generation ??= 0;
    return;
  }
  if (
    runtime.accountId === accountId &&
    runtime.projectId === projectId &&
    runtime.routeEntryId === routeEntryId
  ) {
    runtime.generation ??= 0;
    return;
  }

  const nextGeneration = (runtime.generation ?? 0) + 1;
  if (runtime.fallbackTimer !== undefined) {
    window.clearTimeout(runtime.fallbackTimer);
  }
  clearBoardReadinessMarks();
  window.__htBoardReadinessRuntime = {
    accountId,
    projectId,
    routeEntryId,
    generation: nextGeneration,
  };
};

const emitCompletedTrace = (
  force = false,
  expectedScope?: BoardReadinessTraceScope,
): boolean => {
  if (typeof window === "undefined") return false;
  const runtime = (window.__htBoardReadinessRuntime ??= {});
  if (
    expectedScope &&
    !runtimeMatchesScope(runtime, expectedScope)
  ) {
    return false;
  }
  if (!runtime.completion || runtime.emitted) return false;
  if (
    runtime.accountId !== runtime.completion.accountId ||
    runtime.projectId !== runtime.completion.projectId
  ) {
    return false;
  }
  if (!force && firstMarkTime("networkQueryPublished") === undefined) {
    return false;
  }

  runtime.emitted = true;
  if (runtime.fallbackTimer !== undefined) {
    window.clearTimeout(runtime.fallbackTimer);
    delete runtime.fallbackTimer;
  }

  if (
    !runtime.completion.authenticated ||
    window.location.hostname !== AUTHENTICATED_APP_HOSTNAME
  ) {
    return true;
  }

  const {
    accountId,
    projectId: _projectId,
    authenticated: _authenticated,
    ...completion
  } = runtime.completion;
  emitProductPerformanceEvent({
    event: "app_board_readiness_phases",
    properties: buildBoardReadinessProperties(completion),
  }, accountId);
  return true;
};

export const markBoardNetworkQueryPublished = (
  expectedScope?: BoardReadinessTraceScope | null,
): void => {
  markBoardReadinessPhase("networkQueryPublished", expectedScope);
  markBoardReadinessPhase("queryPublished", expectedScope);
};

export const flushBoardReadinessTrace = (
  expectedScope?: BoardReadinessTraceScope | null,
): void => {
  if (expectedScope === null) return;
  emitCompletedTrace(false, expectedScope);
};

export const emitBoardReadinessAfterPaint = (
  completion: BoardReadinessCompletion,
  expectedScope?: BoardReadinessTraceScope | null,
): boolean => {
  if (typeof window === "undefined" || typeof performance === "undefined") {
    return false;
  }
  if (
    expectedScope === null ||
    !completion.authenticated ||
    !completion.localDatabasePilot ||
    completion.readinessSource === "unknown"
  ) {
    return false;
  }
  const runtime = (window.__htBoardReadinessRuntime ??= {});
  if (
    runtime.readinessEventEmitted ||
    (expectedScope !== undefined &&
      !runtimeMatchesScope(runtime, expectedScope))
  ) {
    return false;
  }
  const startedAt = firstMarkTime("localReadStart");
  if (startedAt === undefined) return false;

  runtime.readinessEventEmitted = true;
  const readyMark =
    completion.readinessSource === "indexeddb"
      ? "ht-board-indexeddb-ready"
      : "ht-board-network-ready";
  performance.mark(readyMark);
  emitProductPerformanceEvent(
    {
      event: "app_board_readiness",
      properties: {
        analytics_surface: "authenticated_app",
        app_hostname: window.location.hostname,
        route_family: "project",
        view_surface: completion.viewSurface,
        readiness_source: completion.readinessSource,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        device_class: window.matchMedia("(max-width: 767px)").matches
          ? "mobile"
          : "desktop",
        local_database_pilot: true,
        readiness_measurement_version: 3,
        readiness_measurement_scope: "project_route_entry",
        project_id: completion.projectId,
      },
    },
    completion.accountId,
  );
  return true;
};

/**
 * Finish the trace after the first Board commit has reached a browser frame.
 * Prefer the reconciled network publication, but never hold the trace forever
 * when a fresh React Query snapshot means the query function does not run.
 */
export const completeBoardReadinessTrace = (
  completion: BoardReadinessCompletion,
  expectedScope?: BoardReadinessTraceScope | null,
): void => {
  if (typeof window === "undefined") return;
  if (expectedScope === null) return;
  const runtime = (window.__htBoardReadinessRuntime ??= {});
  if (runtime.accountId === undefined && runtime.projectId === undefined) {
    runtime.accountId = completion.accountId;
    runtime.projectId = completion.projectId;
    runtime.routeEntryId ??= createBoardReadinessRouteEntryId();
    runtime.generation ??= 0;
  }
  if (
    runtime.accountId !== completion.accountId ||
    runtime.projectId !== completion.projectId ||
    (expectedScope !== undefined &&
      expectedScope !== null &&
      !runtimeMatchesScope(runtime, expectedScope))
  ) {
    return;
  }
  if (runtime.completion || runtime.emitted) return;

  runtime.generation ??= 0;
  const traceScope = expectedScope ?? getBoardReadinessTraceScope();
  if (!traceScope) return;
  runtime.completion = completion;
  markBoardReadinessPhase("usableReady", traceScope);
  if (emitCompletedTrace(false, traceScope)) return;
  runtime.fallbackTimer = window.setTimeout(
    () => emitCompletedTrace(true, traceScope),
    2_000,
  );
};
