import { emitProductPerformanceEvent } from "@/lib/analytics/productPerformance";

export const REALTIME_RECEIPT_TO_REQUEST_BUDGET_MS = 50;
const HISTORY_LIMIT = 100;

export type RealtimeLatencyRecord = {
  surface: "board" | "inbox" | "calendar";
  trigger: "event" | "reconnect";
  result: "success" | "failure";
  eventReceivedMs: number;
  requestStartedMs: number | null;
  renderedMs: number | null;
  receiptToRequestMs: number | null;
  receiptToRenderMs: number | null;
  receiptToRequestP75Ms: number | null;
  receiptToRequestBudgetMet: boolean | null;
};

declare global {
  interface Window {
    __htRealtimeLatencyCanary?: RealtimeLatencyRecord[];
  }
}

type Dependencies = {
  now?: () => number;
  afterRender?: () => Promise<void | false>;
  emit?: (record: RealtimeLatencyRecord, accountId: number) => void;
};

export type StartedRealtimeReconciliation = {
  requestStarted: true;
  completion: Promise<void | boolean>;
};

export const markRealtimeRequestStarted = (
  completion: Promise<void | boolean>,
): StartedRealtimeReconciliation => ({ requestStarted: true, completion });

const isStartedRealtimeReconciliation = (
  value: unknown,
): value is StartedRealtimeReconciliation =>
  typeof value === "object" &&
  value !== null &&
  "requestStarted" in value &&
  value.requestStarted === true &&
  "completion" in value;

const roundTimestamp = (value: number) => Math.max(0, Math.round(value));
const duration = (value: number) => Math.max(0, value);

export const percentile75 = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.75) - 1];
};

const afterBrowserRender = () =>
  new Promise<void | false>((resolve) => {
    if (
      typeof window === "undefined" ||
      !window.requestAnimationFrame ||
      document.visibilityState !== "visible"
    ) {
      resolve(false);
      return;
    }
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    let settled = false;
    const finish = (rendered: void | false) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (rendered === false && window.cancelAnimationFrame) {
        if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
        if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      }
      resolve(rendered);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") finish(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    firstFrame = window.requestAnimationFrame(() => {
      if (document.visibilityState !== "visible") {
        finish(false);
        return;
      }
      secondFrame = window.requestAnimationFrame(() => {
        finish(document.visibilityState === "visible" ? undefined : false);
      });
    });
  });

const emitRecord = (record: RealtimeLatencyRecord, accountId: number) =>
  emitProductPerformanceEvent(
    {
      event: "app_realtime_latency",
      properties: {
        analytics_surface: "authenticated_app",
        app_hostname: typeof window === "undefined" ? "" : location.hostname,
        route_family: "realtime",
        realtime_surface: record.surface,
        trigger: record.trigger,
        result: record.result,
        event_received_ms: roundTimestamp(record.eventReceivedMs),
        request_started_ms:
          record.requestStartedMs === null
            ? null
            : roundTimestamp(record.requestStartedMs),
        rendered_ms:
          record.renderedMs === null ? null : roundTimestamp(record.renderedMs),
        receipt_to_request_ms: record.receiptToRequestMs,
        receipt_to_render_ms: record.receiptToRenderMs,
        receipt_to_request_p75_ms: record.receiptToRequestP75Ms,
        receipt_to_request_budget_met: record.receiptToRequestBudgetMet,
        production_commit: process.env.NEXT_PUBLIC_BUILD_ID || "unknown",
      },
    },
    accountId,
  );

export const createRealtimeLatencyCanary = (dependencies: Dependencies = {}) => {
  const now = dependencies.now ?? (() => performance.now());
  const afterRender = dependencies.afterRender ?? afterBrowserRender;
  const emit = dependencies.emit ?? emitRecord;
  const samples = new Map<string, number[]>();

  const run = async ({
    accountId,
    surface,
    trigger = "event",
    reconcile,
  }: {
    accountId: number;
    surface: RealtimeLatencyRecord["surface"];
    trigger?: RealtimeLatencyRecord["trigger"];
    reconcile: () =>
      | void
      | boolean
      | Promise<void | boolean>
      | StartedRealtimeReconciliation;
  }): Promise<RealtimeLatencyRecord> => {
    const eventReceivedMs = now();
    let requestStartedMs: number | null = null;
    let requestStarted = false;
    let result: RealtimeLatencyRecord["result"] = "failure";
    let renderedMs: number | null = null;
    let reconciliationReturned = false;
    try {
      requestStartedMs = now();
      requestStarted = true;
      const reconciliation = reconcile();
      reconciliationReturned = true;
      if (reconciliation === false) {
        requestStartedMs = null;
        requestStarted = false;
      } else {
        const requestWasMarkedStarted = isStartedRealtimeReconciliation(
          reconciliation,
        );
        const reconciliationResult = await (requestWasMarkedStarted
          ? reconciliation.completion
          : reconciliation);
        if (reconciliationResult === false && !requestWasMarkedStarted) {
          requestStartedMs = null;
          requestStarted = false;
        }
        if (reconciliationResult !== false) {
          if ((await afterRender()) !== false) renderedMs = now();
          result = "success";
        }
      }
    } catch {
      if (!reconciliationReturned) {
        requestStartedMs = null;
        requestStarted = false;
      }
    }

    const receiptToRequestMs =
      requestStartedMs === null
        ? null
        : duration(requestStartedMs - eventReceivedMs);
    const sampleKey = `${accountId}:${surface}`;
    const surfaceSamples = samples.get(sampleKey) ?? [];
    if (trigger === "event" && requestStarted && receiptToRequestMs !== null) {
      surfaceSamples.push(receiptToRequestMs);
      if (surfaceSamples.length > HISTORY_LIMIT) surfaceSamples.shift();
      samples.set(sampleKey, surfaceSamples);
    }
    const receiptToRequestP75Ms = percentile75(surfaceSamples);
    const record: RealtimeLatencyRecord = {
      surface,
      trigger,
      result,
      eventReceivedMs,
      requestStartedMs,
      renderedMs,
      receiptToRequestMs,
      receiptToRenderMs:
        renderedMs === null ? null : duration(renderedMs - eventReceivedMs),
      receiptToRequestP75Ms,
      receiptToRequestBudgetMet:
        receiptToRequestP75Ms === null
          ? null
          : receiptToRequestP75Ms < REALTIME_RECEIPT_TO_REQUEST_BUDGET_MS,
    };
    if (typeof window !== "undefined") {
      const history = (window.__htRealtimeLatencyCanary ??= []);
      history.push(record);
      if (history.length > HISTORY_LIMIT) history.shift();
    }
    try {
      emit(record, accountId);
    } catch {
      // Optional telemetry must not turn a completed reconciliation into a failure.
    }
    return record;
  };
  return { run };
};

export const runRealtimeReconciliation = createRealtimeLatencyCanary().run;
