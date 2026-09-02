import type { CalendarSyncPayloadV1 } from "./contract";
import { buildCalendarAuthorizationRevision } from "./access";

export type CalendarAccessProof = {
  accountId: number;
  projectIds: number[];
  authorizationRevision: string;
};

export type CalendarLoadState = {
  rangeKey: string;
  status: "pending" | "ready" | "error";
};

export const resolveCalendarAccessProof = <T>({
  attempt,
  initialProof,
  fetchProof,
}: {
  attempt: number;
  initialProof?: Promise<T>;
  fetchProof: () => Promise<T>;
}): Promise<T> =>
  attempt === 0 && initialProof ? initialProof : fetchProof();

export const beginCalendarAccessRevalidation = (
  _current: CalendarLoadState,
  activeRangeKey: string,
): CalendarLoadState => ({ rangeKey: activeRangeKey, status: "pending" });

export const settleCalendarAccessSuccess = (
  current: CalendarLoadState,
  activeRangeKey: string,
  retainedProjection: boolean,
): CalendarLoadState =>
  retainedProjection
    ? { rangeKey: activeRangeKey, status: "ready" }
    : current;

export const canRenderCalendarProjection = ({
  projectionAccountId,
  currentAccountId,
  projectionRangeKey,
  activeRangeKey,
  loadState,
}: {
  projectionAccountId?: number;
  currentAccountId: number;
  projectionRangeKey?: string;
  activeRangeKey: string;
  loadState: CalendarLoadState;
}): boolean =>
  projectionAccountId === currentAccountId &&
  projectionRangeKey === activeRangeKey &&
  loadState.rangeKey === activeRangeKey &&
  loadState.status === "ready";

export class CalendarAuthorizationFailure extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CalendarAuthorizationFailure";
    this.status = status;
  }
}

export const isCalendarAuthorizationFailure = (
  error: unknown,
): error is CalendarAuthorizationFailure =>
  error instanceof CalendarAuthorizationFailure;

export const createCalendarHydrationArbiter = () => {
  let authoritativeAccessObserved = false;
  return {
    canHydrateFromCache: () => !authoritativeAccessObserved,
    observeAuthoritativeAccess: () => {
      authoritativeAccessObserved = true;
    },
  };
};

export const intersectAuthorizedCalendarPayload = (
  payload: CalendarSyncPayloadV1,
  access: CalendarAccessProof,
): CalendarSyncPayloadV1 | null => {
  if (
    payload.accountId !== access.accountId ||
    payload.authorizationRevision !== access.authorizationRevision
  ) {
    return null;
  }
  const authorizedIds = new Set(access.projectIds);
  return {
    ...payload,
    projects: payload.projects.filter((project) =>
      authorizedIds.has(project.id),
    ),
    tasks: payload.tasks
      .filter((task) => authorizedIds.has(task.projectId))
      .map((task) => ({
        ...task,
        blockingTasks: task.blockingTasks?.filter((blockingTask) =>
          authorizedIds.has(blockingTask.projectId),
        ),
      })),
  };
};

export const restrictCalendarPayloadToAccess = (
  payload: CalendarSyncPayloadV1,
  access: CalendarAccessProof,
): CalendarSyncPayloadV1 | null => {
  if (payload.accountId !== access.accountId) return null;
  const authorizedIds = new Set(access.projectIds);
  const projects = payload.projects.filter((project) =>
    authorizedIds.has(project.id),
  );
  const retainedProjectIds = new Set(projects.map((project) => project.id));
  return {
    ...payload,
    authorizationRevision: buildCalendarAuthorizationRevision(
      projects.map((project) => project.id),
    ),
    projects,
    tasks: payload.tasks
      .filter((task) => retainedProjectIds.has(task.projectId))
      .map((task) => ({
        ...task,
        blockingTasks: task.blockingTasks?.filter((blockingTask) =>
          retainedProjectIds.has(blockingTask.projectId),
        ),
      })),
  };
};

export const settleCalendarLoadFailure = (
  current: CalendarLoadState,
  activeRangeKey: string,
): CalendarLoadState =>
  current.rangeKey === activeRangeKey && current.status !== "ready"
    ? { rangeKey: activeRangeKey, status: "error" }
    : current;

export const settleCalendarAuthorizationFailure = (
  current: CalendarLoadState,
  activeRangeKey: string,
): CalendarLoadState =>
  current.rangeKey === activeRangeKey
    ? { rangeKey: activeRangeKey, status: "error" }
    : current;
