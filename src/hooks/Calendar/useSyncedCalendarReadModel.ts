import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IProject, ITask } from "@/models/model";
import type { CalendarSettings } from "@/models/Calendar/model";
import {
  createCalendarReadModelSnapshot,
  isCalendarReadModelSnapshotV1,
  materializeCalendarReadModelSnapshot,
  type CalendarSyncPayloadV1,
} from "@/lib/calendarSync/contract";
import {
  buildCalendarVisibleRange,
  resolveCalendarTimezone,
  type CalendarVisibleRange,
} from "@/lib/calendarSync/range";
import { emitProductPerformanceEvent } from "@/lib/analytics/productPerformance";
import {
  getBoardSyncPilotEnabled,
  persistBoardSyncPilotPreference,
} from "@/lib/boardSync/pilot";
import { buildCalendarAuthorizationRevision } from "@/lib/calendarSync/access";
import {
  beginCalendarAccessRevalidation,
  canRenderCalendarProjection,
  intersectAuthorizedCalendarPayload,
  restrictCalendarPayloadToAccess,
  createCalendarHydrationArbiter,
  CalendarAuthorizationFailure,
  isCalendarAuthorizationFailure,
  resolveCalendarAccessProof,
  settleCalendarAccessSuccess,
  settleCalendarAuthorizationFailure,
  settleCalendarLoadFailure,
  type CalendarAccessProof,
  type CalendarLoadState,
} from "@/lib/calendarSync/clientPolicy";

type ReconciliationTrigger =
  | "mount"
  | "range"
  | "realtime"
  | "manual"
  | "focus";

type CalendarProjection = {
  accountId: number;
  rangeKey: string;
  payload: CalendarSyncPayloadV1;
};

const rangeKey = (range: CalendarVisibleRange) =>
  `${range.timezone}:${range.rangeStart}:${range.rangeEndExclusive}`;

const deviceClass = () =>
  window.matchMedia("(max-width: 767px)").matches
    ? ("mobile" as const)
    : ("desktop" as const);

export const createCalendarReadinessLatch = (): { claim: () => boolean } => {
  let claimed = false;
  return {
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };
};

type LocalReadinessOutcome = "miss" | "error" | "none";
type LocalReadinessOutcomeRef = { current: LocalReadinessOutcome };

const readinessProperties = (
  range: CalendarVisibleRange,
  source: "indexeddb" | "network",
  durationMs: number,
  localOutcome: LocalReadinessOutcome,
) => ({
  analytics_surface: "authenticated_app" as const,
  app_hostname: window.location.hostname,
  route_family: "calendar" as const,
  calendar_measurement_version: 1 as const,
  readiness_source: source,
  local_outcome: localOutcome,
  duration_ms: Math.max(0, Math.round(durationMs)),
  device_class: deviceClass(),
  range_days: Math.max(
    1,
    Math.round(
      (Date.parse(range.endExclusiveIso) - Date.parse(range.startIso)) /
        (24 * 60 * 60 * 1_000),
    ),
  ),
});

const reconciliationProperties = (
  result: "success" | "failure",
  trigger: ReconciliationTrigger,
  durationMs: number,
) => ({
  analytics_surface: "authenticated_app" as const,
  app_hostname: window.location.hostname,
  route_family: "calendar" as const,
  result,
  trigger,
  duration_ms: Math.max(0, Math.round(durationMs)),
  device_class: deviceClass(),
});

const fetchCalendarPayload = async (
  range: CalendarVisibleRange,
  signal: AbortSignal,
): Promise<unknown> => {
  const params = new URLSearchParams({
    rangeStart: range.rangeStart,
    rangeEndExclusive: range.rangeEndExclusive,
    start: range.startIso,
    endExclusive: range.endExclusiveIso,
    timezone: range.timezone,
  });
  const response = await fetch(`/api/calendar/read-model?${params}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const message = `Calendar reconciliation failed (${response.status})`;
    if (response.status === 401 || response.status === 403) {
      throw new CalendarAuthorizationFailure(message, response.status);
    }
    throw new Error(message);
  }
  const body = await response.json();
  return body?.payload;
};

const fetchCalendarAccess = async (
  signal: AbortSignal,
): Promise<CalendarAccessProof> => {
  let response: Response;
  try {
    response = await fetch("/api/calendar/access", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CalendarAuthorizationFailure(
      "Calendar access check could not verify authorization",
    );
  }
  if (!response.ok) {
    throw new CalendarAuthorizationFailure(
      `Calendar access check failed (${response.status})`,
      response.status,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CalendarAuthorizationFailure(
      "Calendar access check returned an invalid response",
    );
  }
  const accountId = Number((body as { accountId?: unknown })?.accountId);
  const access: CalendarAccessProof = {
    accountId,
    projectIds: Array.isArray((body as { projectIds?: unknown })?.projectIds)
      ? (body as { projectIds: unknown[] }).projectIds.filter(
          (id: unknown): id is number =>
            typeof id === "number" && Number.isInteger(id) && id > 0,
        )
      : [],
    authorizationRevision: String(
      (body as { authorizationRevision?: unknown })?.authorizationRevision ??
        "",
    ),
  };
  if (
    !Number.isInteger(access.accountId) ||
    access.accountId <= 0 ||
    buildCalendarAuthorizationRevision(access.projectIds) !==
      access.authorizationRevision
  ) {
    throw new CalendarAuthorizationFailure("Calendar access contract mismatch");
  }
  return access;
};

export const useSyncedCalendarReadModel = ({
  accountId,
  currentDate,
  currentView,
  weekStartsOn,
}: {
  accountId: number;
  currentDate: Date;
  currentView: "month" | "week" | "day";
  weekStartsOn: CalendarSettings["weekStartsOn"];
}) => {
  const [timezone, setTimezone] = useState(resolveCalendarTimezone);
  const anchorYear = currentDate.getFullYear();
  const anchorMonth = currentDate.getMonth();
  const anchorDay = currentDate.getDate();
  const range = useMemo(
    () =>
      buildCalendarVisibleRange({
        anchor: new Date(anchorYear, anchorMonth, anchorDay),
        view: currentView,
        weekStartsOn,
        timezone,
      }),
    [anchorDay, anchorMonth, anchorYear, currentView, timezone, weekStartsOn],
  );
  const activeRangeKey = rangeKey(range);
  const [projection, setProjection] = useState<CalendarProjection | null>(null);
  const projectionRef = useRef<CalendarProjection | null>(null);
  const updateProjection = useCallback(
    (
      updater: (current: CalendarProjection | null) => CalendarProjection | null,
    ): CalendarProjection | null => {
      const next = updater(projectionRef.current);
      projectionRef.current = next;
      setProjection(next);
      return next;
    },
    [],
  );
  const [loadState, setLoadState] = useState<CalendarLoadState>({
    rangeKey: activeRangeKey,
    status: "pending",
  });
  const [cachePolicy, setCachePolicy] = useState<{
    resolved: boolean;
    enabled: boolean;
  }>({ resolved: false, enabled: false });
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const firstRangeRef = useRef<string | null>(null);

  const refreshTimezone = useCallback(() => {
    const currentTimezone = resolveCalendarTimezone();
    setTimezone((previous) =>
      previous === currentTimezone ? previous : currentTimezone,
    );
    return currentTimezone;
  }, []);

  useEffect(() => {
    const parameter = new URLSearchParams(window.location.search).get(
      "local_db",
    );
    persistBoardSyncPilotPreference(parameter);
    setCachePolicy({
      resolved: true,
      enabled: getBoardSyncPilotEnabled(parameter),
    });
  }, []);

  const acceptPayload = useCallback(
    (candidate: unknown): CalendarSyncPayloadV1 | null => {
      const snapshot = createCalendarReadModelSnapshot({
        payload: candidate as CalendarSyncPayloadV1,
      });
      if (
        !snapshot ||
        !isCalendarReadModelSnapshotV1(snapshot, { accountId, range })
      ) {
        return null;
      }
      return materializeCalendarReadModelSnapshot(snapshot);
    },
    [accountId, activeRangeKey],
  );

  const runAuthoritativeReconciliation = useCallback(
    async (
      sequence: number,
      controller: AbortController,
      trigger: ReconciliationTrigger,
      startedAt: number,
      emitReadiness: boolean,
      readinessLatch:
        | ReturnType<typeof createCalendarReadinessLatch>
        | undefined,
      onAuthoritativeAccessObserved?: () => void,
      initialAccessPromise?: Promise<CalendarAccessProof>,
      readinessLocalOutcome?: LocalReadinessOutcomeRef,
    ) => {
      try {
        let payload: CalendarSyncPayloadV1 | null = null;
        for (let attempt = 0; attempt < 2 && !payload; attempt += 1) {
          const candidateResult = fetchCalendarPayload(
            range,
            controller.signal,
          ).then(
            (candidate) => ({ ok: true as const, candidate }),
            (error: unknown) => ({ ok: false as const, error }),
          );
          const access = await resolveCalendarAccessProof({
            attempt,
            initialProof: initialAccessPromise,
            fetchProof: () => fetchCalendarAccess(controller.signal),
          });
          if (attempt > 0 || !initialAccessPromise) {
            onAuthoritativeAccessObserved?.();
          }
          if (access.accountId !== accountId) {
            throw new CalendarAuthorizationFailure(
              "Calendar access check returned another account",
            );
          }
          if (
            controller.signal.aborted ||
            sequence !== requestSequence.current
          ) {
            return false;
          }
          const retainedProjection = updateProjection((current) => {
            if (
              !current ||
              current.accountId !== accountId ||
              current.rangeKey !== activeRangeKey
            ) {
              return current;
            }
            const retainedPayload = restrictCalendarPayloadToAccess(
              current.payload,
              access,
            );
            return retainedPayload
              ? { ...current, payload: retainedPayload }
              : null;
          });
          setLoadState((current) =>
            settleCalendarAccessSuccess(
              current,
              activeRangeKey,
              retainedProjection?.accountId === accountId &&
                retainedProjection.rangeKey === activeRangeKey,
            ),
          );

          const result = await candidateResult;
          if (!result.ok) throw result.error;
          const candidate = result.candidate;
          const acceptedPayload = acceptPayload(candidate);
          if (!acceptedPayload) {
            throw new Error("Calendar response contract mismatch");
          }
          payload = intersectAuthorizedCalendarPayload(acceptedPayload, access);
          if (access.accountId === accountId && payload) break;
          onAuthoritativeAccessObserved?.();
          if (
            controller.signal.aborted ||
            sequence !== requestSequence.current
          ) {
            return false;
          }

          setLoadState({ rangeKey: activeRangeKey, status: "pending" });

          if (attempt === 1) {
            throw new Error("Calendar access changed during reconciliation");
          }
        }
        if (!payload)
          throw new Error("Calendar reconciliation produced no payload");
        if (controller.signal.aborted || sequence !== requestSequence.current) {
          return false;
        }
        onAuthoritativeAccessObserved?.();
        updateProjection(() => ({
          accountId,
          rangeKey: activeRangeKey,
          payload,
        }));
        setLoadState({ rangeKey: activeRangeKey, status: "ready" });
        if (cachePolicy.enabled) {
          void import("@/lib/calendarSync/indexedDbReadModel").then(
            ({ writeCalendarReadModel }) => writeCalendarReadModel(payload),
          );
        }
        if (emitReadiness && readinessLatch?.claim()) {
          performance.mark("ht-calendar-network-ready");
          emitProductPerformanceEvent(
            {
              event: "app_calendar_readiness",
              properties: readinessProperties(
                range,
                "network",
                performance.now() - startedAt,
                readinessLocalOutcome?.current ?? "none",
              ),
            },
            accountId,
          );
        }
        emitProductPerformanceEvent({
          event: "app_calendar_reconciliation",
          properties: reconciliationProperties(
            "success",
            trigger,
            performance.now() - startedAt,
          ),
        }, accountId);
        return true;
      } catch (error) {
        if (controller.signal.aborted) return false;
        if (isCalendarAuthorizationFailure(error)) {
          onAuthoritativeAccessObserved?.();
          updateProjection((current) =>
            current?.accountId === accountId &&
            current.rangeKey === activeRangeKey
              ? null
              : current,
          );
          setLoadState((current) =>
            settleCalendarAuthorizationFailure(current, activeRangeKey),
          );
        } else {
          setLoadState((current) =>
            settleCalendarLoadFailure(current, activeRangeKey),
          );
        }
        emitProductPerformanceEvent({
          event: "app_calendar_reconciliation",
          properties: reconciliationProperties(
            "failure",
            trigger,
            performance.now() - startedAt,
          ),
        }, accountId);
        console.error("Calendar reconciliation failed:", error);
        return false;
      }
    },
    [
      acceptPayload,
      accountId,
      activeRangeKey,
      cachePolicy.enabled,
      updateProjection,
    ],
  );

  useEffect(() => {
    if (!cachePolicy.resolved) return;
    const sequence = ++requestSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const startedAt = performance.now();
    const hydrationArbiter = createCalendarHydrationArbiter();
    const readinessLatch = createCalendarReadinessLatch();
    const readinessLocalOutcome: LocalReadinessOutcomeRef = { current: "none" };
    const trigger: ReconciliationTrigger =
      firstRangeRef.current == null ? "mount" : "range";
    firstRangeRef.current = activeRangeKey;
    setLoadState({ rangeKey: activeRangeKey, status: "pending" });

    const initialAccessPromise = cachePolicy.enabled
      ? fetchCalendarAccess(controller.signal).catch(
        (error) => {
          if (
            !controller.signal.aborted &&
            isCalendarAuthorizationFailure(error)
          ) {
            hydrationArbiter.observeAuthoritativeAccess();
            updateProjection((current) =>
              current?.accountId === accountId &&
              current.rangeKey === activeRangeKey
                ? null
                : current,
            );
            setLoadState((current) =>
              settleCalendarAuthorizationFailure(current, activeRangeKey),
            );
          }
          throw error;
        },
      )
      : undefined;
    if (initialAccessPromise) {
      void Promise.all([
        initialAccessPromise,
        import("@/lib/calendarSync/indexedDbReadModel"),
      ])
        .then(async ([access, { readCalendarReadModel }]) => {
          if (access.accountId !== accountId) return;
          const cached = await readCalendarReadModel(
            accountId,
            range,
            access.authorizationRevision,
          );
          if (
            controller.signal.aborted ||
            !hydrationArbiter.canHydrateFromCache() ||
            sequence !== requestSequence.current
          ) {
            return;
          }
          const authorizedCached = cached
            ? intersectAuthorizedCalendarPayload(cached, access)
            : null;
          if (authorizedCached) {
            updateProjection(() => ({
              accountId,
              rangeKey: activeRangeKey,
              payload: authorizedCached,
            }));
            setLoadState({ rangeKey: activeRangeKey, status: "ready" });
            if (readinessLatch.claim()) {
              performance.mark("ht-calendar-indexeddb-ready");
              emitProductPerformanceEvent(
                {
                  event: "app_calendar_readiness",
                  properties: readinessProperties(
                    range,
                    "indexeddb",
                    performance.now() - startedAt,
                    "none",
                  ),
                },
                accountId,
              );
            }
          } else {
            readinessLocalOutcome.current = "miss";
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            readinessLocalOutcome.current = "error";
            console.error("Calendar cache access check failed:", error);
          }
        });
    }

    void runAuthoritativeReconciliation(
      sequence,
      controller,
      trigger,
      startedAt,
      true,
      readinessLatch,
      () => {
        hydrationArbiter.observeAuthoritativeAccess();
      },
      initialAccessPromise,
      readinessLocalOutcome,
    );

    return () => controller.abort();
  }, [
    accountId,
    activeRangeKey,
    cachePolicy.enabled,
    cachePolicy.resolved,
    runAuthoritativeReconciliation,
    updateProjection,
  ]);

  const reconcile = useCallback(
    (trigger: "realtime" | "manual" | "focus" = "manual") => {
      if (refreshTimezone() !== timezone) return false;
      const sequence = ++requestSequence.current;
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;
      setLoadState((current) =>
        beginCalendarAccessRevalidation(current, activeRangeKey),
      );
      return runAuthoritativeReconciliation(
        sequence,
        controller,
        trigger,
        performance.now(),
        false,
        undefined,
      );
    },
    [activeRangeKey, refreshTimezone, runAuthoritativeReconciliation, timezone],
  );

  useEffect(() => {
    const revalidateWhenVisible = () => {
      if (document.visibilityState === "visible") reconcile("focus");
    };
    window.addEventListener("focus", revalidateWhenVisible);
    document.addEventListener("visibilitychange", revalidateWhenVisible);
    return () => {
      window.removeEventListener("focus", revalidateWhenVisible);
      document.removeEventListener("visibilitychange", revalidateWhenVisible);
    };
  }, [reconcile]);

  const updateTaskProjection = useCallback(
    (task: ITask) => {
      updateProjection((current) => {
        if (
          !current ||
          current.accountId !== accountId ||
          current.rangeKey !== activeRangeKey
        ) {
          return current;
        }
        const dueAt = task.dueDate ? new Date(task.dueDate).getTime() : NaN;
        const belongsInRange =
          Number.isFinite(dueAt) &&
          dueAt >= Date.parse(range.startIso) &&
          dueAt < Date.parse(range.endExclusiveIso) &&
          !task.deletedAt;
        const existingIndex = current.payload.tasks.findIndex(
          (candidate) => candidate.id === task.id,
        );
        const tasks = [...current.payload.tasks];
        if (belongsInRange && existingIndex >= 0) tasks[existingIndex] = task;
        else if (belongsInRange) tasks.push(task);
        else if (existingIndex >= 0) tasks.splice(existingIndex, 1);
        else return current;

        const payload: CalendarSyncPayloadV1 = {
          ...current.payload,
          tasks,
        };
        return { ...current, payload };
      });
    },
    [accountId, activeRangeKey, updateProjection],
  );

  const activeLoadState =
    loadState.rangeKey === activeRangeKey
      ? loadState.status
      : ("pending" as const);
  const usableProjection = canRenderCalendarProjection({
    projectionAccountId: projection?.accountId,
    currentAccountId: accountId,
    projectionRangeKey: projection?.rangeKey,
    activeRangeKey,
    loadState,
  })
    ? projection
    : null;

  return {
    tasks: usableProjection?.payload.tasks ?? [],
    projects: usableProjection?.payload.projects ?? [],
    isPending: activeLoadState === "pending",
    hasError: activeLoadState === "error",
    reconcile,
    retry: () => reconcile("manual"),
    updateTaskProjection,
  };
};
