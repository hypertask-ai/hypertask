export type BoardReadinessPerformanceEvent = {
  event: "app_board_readiness";
  properties: {
    analytics_surface: "authenticated_app";
    app_hostname: string;
    route_family: "project";
    view_surface: "board" | "table";
    readiness_source: "indexeddb" | "network" | "indexeddb_miss";
    duration_ms: number;
    device_class: "mobile" | "desktop";
    local_database_pilot: true;
    readiness_measurement_version: 3;
    readiness_measurement_scope: "project_route_entry";
    project_id: number;
  };
};

export type BoardReadinessPhasesPerformanceEvent = {
  event: "app_board_readiness_phases";
  properties: {
    analytics_surface: "authenticated_app";
    app_hostname: string;
    route_family: "project";
    route_path: "/project";
    view_surface: "board" | "table";
    readiness_source: "indexeddb" | "network" | "unknown";
    device_class: "mobile" | "desktop";
    local_database_pilot: boolean;
    production_commit: string;
    trace_complete: boolean;
    missing_phases: string;
    trace_order_valid: boolean;
    invalid_phase_order: string;
    bootstrap_start_ms: number | null;
    auth_available_ms: number | null;
    projects_request_start_ms: number | null;
    projects_fallback_start_ms: number | null;
    projects_request_attempt: "parser" | "client";
    projects_request_finish_ms: number | null;
    projects_request_duration_ms: number | null;
    board_request_start_ms: number | null;
    board_fallback_start_ms: number | null;
    board_request_attempt: "parser" | "client";
    board_request_finish_ms: number | null;
    board_request_duration_ms: number | null;
    local_read_start_ms: number | null;
    local_read_finish_ms: number | null;
    local_read_duration_ms: number | null;
    query_published_ms: number | null;
    network_query_published_ms: number | null;
    first_board_commit_ms: number | null;
    query_to_commit_ms: number | null;
    usable_ready_ms: number | null;
    commit_to_usable_ms: number | null;
    total_ready_ms: number | null;
  };
};

export type CalendarPerformanceEvent =
  | {
      event: "app_calendar_readiness";
      properties: {
        analytics_surface: "authenticated_app";
        app_hostname: string;
        route_family: "calendar";
        calendar_measurement_version: 1;
        readiness_source: "indexeddb" | "network" | "indexeddb_miss";
        local_outcome: "miss" | "error" | "none";
        duration_ms: number;
        device_class: "mobile" | "desktop";
        range_days: number;
      };
    }
  | {
      event: "app_calendar_reconciliation";
      properties: {
        analytics_surface: "authenticated_app";
        app_hostname: string;
        route_family: "calendar";
        result: "success" | "failure";
        trigger: "mount" | "range" | "realtime" | "manual" | "focus";
        duration_ms: number;
        device_class: "mobile" | "desktop";
      };
    };

export type InboxReadinessPerformanceEvent = {
  event: "app_inbox_readiness";
  properties: {
    analytics_surface: "authenticated_app";
    app_hostname: string;
    route_family: "inbox";
    inbox_measurement_version: 2;
    readiness_source: "indexeddb" | "network" | "indexeddb_miss";
    local_outcome: "miss" | "error" | "none";
    duration_ms: number;
    device_class: "mobile" | "desktop";
    local_read_model_enabled: boolean;
    notification_count: number;
  };
};

export type TaskCreateVisibleCompletion =
  | "task_detail"
  | "modal_closed"
  | "composer_reset"
  | "error";

export type TaskCreatePerformanceEvent = {
  event: "app_task_create_latency";
  properties: {
    analytics_surface: "authenticated_app";
    app_hostname: string;
    route_family: "task_create";
    create_surface: "global_modal";
    duration_ms: number | null;
    network_duration_ms: number | null;
    submit_to_visible_ms: number | null;
    server_validate_ms: number | null;
    server_task_create_ms: number | null;
    server_enrich_ms: number | null;
    server_total_ms: number | null;
    device_class: "mobile" | "desktop";
    project_id: number;
    result: "success" | "error";
    response_status: number;
    visible_completion: TaskCreateVisibleCompletion;
    task_create_measurement_version: 2;
    task_create_measurement_scope: "submit_to_visible";
  };
};

export type RealtimeLatencyPerformanceEvent = {
  event: "app_realtime_latency";
  properties: {
    analytics_surface: "authenticated_app";
    app_hostname: string;
    route_family: "realtime";
    realtime_surface: "board" | "inbox" | "calendar";
    trigger: "event" | "reconnect";
    result: "success" | "failure";
    event_received_ms: number;
    request_started_ms: number | null;
    rendered_ms: number | null;
    receipt_to_request_ms: number | null;
    receipt_to_render_ms: number | null;
    receipt_to_request_p75_ms: number | null;
    receipt_to_request_budget_met: boolean | null;
    // HTPR-6166: fetch time vs main-thread blocking, split out of
    // receipt_to_render_ms. null means unmeasurable (API unsupported), not 0.
    network_ms: number | null;
    long_task_ms: number | null;
    realtime_project_id: number | null;
    production_commit: string;
  };
};

export type TaskDetailReadinessPerformanceEvent = {
  event: "app_task_detail_readiness";
  properties: {
    analytics_surface: "authenticated_app";
    app_hostname: string;
    route_family: "task_detail";
    route_path: "/detail";
    entry_path: "board" | "inbox" | "calendar" | "direct_route" | "unknown";
    navigation_mode: "client_navigation" | "hard_navigation" | "unknown";
    navigation_type: string;
    duration_ms: number | null;
    device_class: "mobile" | "desktop";
    project_id: number;
    task_id: number;
    measurement_eligible: boolean;
    exclusion_reason:
      | "none"
      | "missing_start_marker"
      | "duration_out_of_range"
      | "usable_state_timeout";
    readiness_measurement_version: 1;
    readiness_measurement_scope: "task_detail_open_to_usable";
  };
};

export type BoardSwitchLatencyPerformanceEvent = {
  event: "app_board_switch_latency";
  properties: {
    analytics_surface: "authenticated_app";
    app_hostname: string;
    route_family: "project";
    view_surface: "board" | "table";
    switch_surface: "sidebar" | "keyboard_shortcut" | "mobile";
    readiness_source: "indexeddb" | "network" | "unknown";
    duration_ms: number;
    device_class: "mobile" | "desktop";
    project_id: number;
    switch_measurement_version: 1;
    switch_measurement_scope: "board_switch_intent_to_usable";
  };
};

export type ProductPerformanceEvent =
  | BoardReadinessPerformanceEvent
  | BoardReadinessPhasesPerformanceEvent
  | InboxReadinessPerformanceEvent
  | TaskDetailReadinessPerformanceEvent
  | TaskCreatePerformanceEvent
  | RealtimeLatencyPerformanceEvent
  | BoardSwitchLatencyPerformanceEvent;

type ProductPerformanceQueueEvent =
  | ProductPerformanceEvent
  | CalendarPerformanceEvent;

type QueuedProductPerformanceEvent = ProductPerformanceQueueEvent & {
  __hypertaskAccountId: number;
};

export const PRODUCT_PERFORMANCE_READY_EVENT =
  "hypertask:product-performance-ready";

export const isProductReadinessEvent = (
  event: ProductPerformanceQueueEvent,
): boolean =>
  event.event === "app_board_readiness" ||
  event.event === "app_board_readiness_phases" ||
  event.event === "app_inbox_readiness" ||
  event.event === "app_task_detail_readiness" ||
  event.event === "app_calendar_readiness";

export type TaskCreateServerTimings = {
  validate: number | null;
  taskCreate: number | null;
  enrich: number | null;
  total: number | null;
};

export type TaskCreateTraceScope = {
  traceId: number;
};

type TaskCreateTraceRuntime = TaskCreateTraceScope & {
  accountId: number;
  projectId: number;
  startedAt: number;
  networkDurationMs: number | null;
  responseStatus: number;
  responseRecorded: boolean;
  serverTimings: TaskCreateServerTimings;
};

let taskCreateTraceSequence = 0;

const emptyTaskCreateServerTimings = (): TaskCreateServerTimings => ({
  validate: null,
  taskCreate: null,
  enrich: null,
  total: null,
});

declare global {
  interface Window {
    __hypertaskProductPerformanceQueue?: QueuedProductPerformanceEvent[];
    __hypertaskProductPerformanceSink?: (
      event: ProductPerformanceQueueEvent,
      accountId: number,
    ) => void;
    __htTaskCreateTraces?: Map<number, TaskCreateTraceRuntime>;
  }
}

export const emitProductPerformanceEvent = (
  event: ProductPerformanceQueueEvent,
  accountId: number,
): void => {
  if (typeof window === "undefined") return;
  if (window.__hypertaskProductPerformanceSink) {
    window.__hypertaskProductPerformanceSink(event, accountId);
  } else {
    const queue = (window.__hypertaskProductPerformanceQueue ??= []);
    queue.push({ ...event, __hypertaskAccountId: accountId });
    if (queue.length > 20) {
      const nonReadinessIndex = queue.findIndex(
        (queuedEvent) => !isProductReadinessEvent(queuedEvent),
      );
      queue.splice(nonReadinessIndex === -1 ? 0 : nonReadinessIndex, 1);
    }
  }

  // Authenticated analytics can wait until useful product content is ready.
  // Dispatch only after queueing so a late-loading sink cannot miss the event.
  if (isProductReadinessEvent(event)) {
    window.dispatchEvent(new Event(PRODUCT_PERFORMANCE_READY_EVENT));
  }
};

export const emitTaskCreatePerformanceEvent = (
  event: TaskCreatePerformanceEvent,
  accountId: number,
): void => {
  emitProductPerformanceEvent(event, accountId);
};

export const parseTaskCreateServerTiming = (
  header: string | null | undefined,
): TaskCreateServerTimings => {
  const timings = emptyTaskCreateServerTimings();
  if (!header) return timings;

  for (const segment of header.split(",")) {
    const name = segment.split(";", 1)[0]?.trim().toLowerCase();
    const durationMatch = segment.match(
      /(?:^|;)\s*dur\s*=\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
    );
    if (!durationMatch) continue;
    const value = Number(durationMatch[1]);
    if (!Number.isFinite(value) || value < 0) continue;

    if (name === "validate") timings.validate = value;
    else if (name === "task-create") timings.taskCreate = value;
    else if (name === "enrich") timings.enrich = value;
    else if (name === "total") timings.total = value;
  }

  return timings;
};

const taskCreateScopeMatches = (
  runtime: TaskCreateTraceRuntime,
  scope: TaskCreateTraceScope,
): boolean => runtime.traceId === scope.traceId;

export const beginTaskCreatePerformanceTrace = ({
  accountId,
  projectId,
}: {
  accountId: number;
  projectId: number;
}): TaskCreateTraceScope | null => {
  if (
    typeof window === "undefined" ||
    typeof performance === "undefined" ||
    !Number.isInteger(accountId) ||
    !Number.isInteger(projectId)
  ) {
    return null;
  }

  const scope = { traceId: ++taskCreateTraceSequence };
  const traces = (window.__htTaskCreateTraces ??= new Map());
  traces.set(scope.traceId, {
    ...scope,
    accountId,
    projectId,
    startedAt: performance.now(),
    networkDurationMs: null,
    responseStatus: 0,
    responseRecorded: false,
    serverTimings: emptyTaskCreateServerTimings(),
  });
  performance.mark("ht-task-create-submit");
  return scope;
};

export const getTaskCreatePerformanceTraceScope =
  (): TaskCreateTraceScope | null => {
    if (typeof window === "undefined") return null;
    const traceIds = window.__htTaskCreateTraces?.keys();
    if (!traceIds) return null;
    let traceId: number | undefined;
    for (const candidate of traceIds) traceId = candidate;
    return traceId === undefined ? null : { traceId };
  };

export const recordTaskCreateResponse = ({
  accountId,
  projectId,
  networkDurationMs,
  responseStatus,
  serverTimings,
  result,
  scope,
}: {
  accountId: number;
  projectId: number;
  networkDurationMs: number;
  responseStatus: number;
  serverTimings: TaskCreateServerTimings;
  result: "success" | "error";
  scope: TaskCreateTraceScope | null;
}): boolean => {
  if (typeof window === "undefined" || scope === null) return false;
  const runtime = window.__htTaskCreateTraces?.get(scope.traceId);
  if (
    !runtime ||
    runtime.responseRecorded ||
    !taskCreateScopeMatches(runtime, scope) ||
    runtime.accountId !== accountId ||
    runtime.projectId !== projectId
  ) {
    return false;
  }

  runtime.responseRecorded = true;
  runtime.networkDurationMs = Math.max(0, Math.round(networkDurationMs));
  runtime.responseStatus = responseStatus;
  runtime.serverTimings = serverTimings;
  if (typeof performance !== "undefined") {
    performance.mark(`ht-task-create-response-${result}`);
  }
  return true;
};

export const completeTaskCreatePerformanceTrace = (
  visibleCompletion: TaskCreateVisibleCompletion,
  scope: TaskCreateTraceScope | null,
): boolean => {
  if (
    typeof window === "undefined" ||
    typeof performance === "undefined" ||
    scope === null
  ) {
    return false;
  }
  const traces = window.__htTaskCreateTraces;
  const runtime = traces?.get(scope.traceId);
  if (!traces || !runtime || !taskCreateScopeMatches(runtime, scope)) {
    return false;
  }

  traces.delete(scope.traceId);
  if (traces.size === 0) delete window.__htTaskCreateTraces;
  const result = visibleCompletion === "error" ? "error" : "success";
  const submitToVisibleMs =
    result === "success"
      ? Math.max(0, Math.round(performance.now() - runtime.startedAt))
      : null;
  performance.mark(`ht-task-create-visible-${visibleCompletion}`);
  emitTaskCreatePerformanceEvent(
    {
      event: "app_task_create_latency",
      properties: {
        analytics_surface: "authenticated_app",
        app_hostname: window.location.hostname,
        route_family: "task_create",
        create_surface: "global_modal",
        duration_ms: runtime.networkDurationMs,
        network_duration_ms: runtime.networkDurationMs,
        submit_to_visible_ms: submitToVisibleMs,
        server_validate_ms: runtime.serverTimings.validate,
        server_task_create_ms: runtime.serverTimings.taskCreate,
        server_enrich_ms: runtime.serverTimings.enrich,
        server_total_ms: runtime.serverTimings.total,
        device_class: window.matchMedia("(max-width: 767px)").matches
          ? "mobile"
          : "desktop",
        project_id: runtime.projectId,
        result,
        response_status: runtime.responseStatus,
        visible_completion: visibleCompletion,
        task_create_measurement_version: 2,
        task_create_measurement_scope: "submit_to_visible",
      },
    },
    runtime.accountId,
  );
  return true;
};

export const completeTaskCreatePerformanceTraceAfterPaint = (
  visibleCompletion: Exclude<TaskCreateVisibleCompletion, "error">,
  scope: TaskCreateTraceScope | null,
): boolean => {
  if (
    typeof window === "undefined" ||
    scope === null ||
    !window.__htTaskCreateTraces?.has(scope.traceId)
  ) {
    return false;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      completeTaskCreatePerformanceTrace(visibleCompletion, scope);
    });
  });
  return true;
};

export const completeTaskCreatePerformanceTraceAfterElementRemoved = (
  visibleCompletion: Exclude<TaskCreateVisibleCompletion, "error">,
  scope: TaskCreateTraceScope | null,
  elementId: string,
): boolean => {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    scope === null ||
    !window.__htTaskCreateTraces?.has(scope.traceId)
  ) {
    return false;
  }

  const waitForRemoval = () => {
    if (document.getElementById(elementId)) {
      window.requestAnimationFrame(waitForRemoval);
      return;
    }
    completeTaskCreatePerformanceTraceAfterPaint(visibleCompletion, scope);
  };
  window.requestAnimationFrame(waitForRemoval);
  return true;
};

export const installProductPerformanceSink = (
  sink: (event: ProductPerformanceQueueEvent, accountId: number) => void,
): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.__hypertaskProductPerformanceSink = sink;
  const queued = window.__hypertaskProductPerformanceQueue?.splice(0) ?? [];
  queued.forEach(({ __hypertaskAccountId, ...event }) =>
    sink(event as ProductPerformanceQueueEvent, __hypertaskAccountId),
  );
  return () => {
    if (window.__hypertaskProductPerformanceSink === sink) {
      delete window.__hypertaskProductPerformanceSink;
    }
  };
};
