import type { ITask } from "@/models/model";
import type { CalendarVisibleRange } from "./range";
import { validateCalendarVisibleRange } from "./range";
import { buildCalendarAuthorizationRevision } from "./access";
import { calendarTaskOverlapsRange } from "./taskRange";

export const CALENDAR_SYNC_CONTRACT_VERSION = 1 as const;
export const CALENDAR_READ_MODEL_SCHEMA_VERSION = 3 as const;
export const CALENDAR_READ_MODEL_TTL_MS = 24 * 60 * 60 * 1_000;

export type CalendarUserSummary = {
  id: number;
  displayName: string | null;
  photoURL: string | null;
};

export type CalendarTaskV1 = Omit<ITask, "waitingOnUser"> & {
  waitingOnUser: CalendarUserSummary | null;
};

export type CalendarLabelSummary = {
  id: string;
  value: string;
  projectId: number;
};

export type CalendarProjectV1 = {
  id: number;
  name: string;
  title: string | null;
  members: Array<{ user: CalendarUserSummary }>;
  labels: CalendarLabelSummary[];
  _count: { tasks: number };
};

export type CalendarSyncPayloadV1 = CalendarVisibleRange & {
  accountId: number;
  authorizationRevision: string;
  retrievedAt: string;
  tasks: CalendarTaskV1[];
  projects: CalendarProjectV1[];
};

export type CalendarReadModelSnapshotV1 = CalendarVisibleRange & {
  key: string;
  contractVersion: typeof CALENDAR_SYNC_CONTRACT_VERSION;
  schemaVersion: typeof CALENDAR_READ_MODEL_SCHEMA_VERSION;
  accountId: number;
  authorizationRevision: string;
  savedAt: string;
  expiresAt: string;
  retrievedAt: string;
  taskOrder: number[];
  tasksById: Record<string, CalendarTaskV1>;
  projectOrder: number[];
  projectsById: Record<string, CalendarProjectV1>;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && !Array.isArray(value) && typeof value === "object";

const isNullableString = (value: unknown): value is string | null =>
  typeof value === "string" || value === null;

const isNullablePositiveInteger = (value: unknown): value is number | null =>
  value === null || isPositiveInteger(value);

const isDateValue = (value: unknown): boolean =>
  (typeof value === "string" || value instanceof Date) &&
  Number.isFinite(new Date(value).getTime());

const isNullableDateValue = (value: unknown): boolean =>
  value === null || isDateValue(value);

const normalizeCalendarTaskForSnapshot = (value: unknown): unknown =>
  isRecord(value)
    ? {
        ...value,
        // The application model represents an unset start date as undefined,
        // while the persisted contract uses an explicit nullable field.
        startDate: value.startDate ?? null,
      }
    : value;

const SAFE_USER_KEYS = new Set(["id", "displayName", "photoURL"]);
const SAFE_AGENT_KEYS = new Set(["id", "displayName", "photoURL"]);

const isCalendarUserSummary = (
  value: unknown,
): value is CalendarUserSummary => {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const user = value as Partial<CalendarUserSummary>;
  return (
    isPositiveInteger(user.id) &&
    (typeof user.displayName === "string" || user.displayName === null) &&
    (typeof user.photoURL === "string" || user.photoURL === null)
  );
};

const isCalendarLabelSummary = (
  value: unknown,
): value is CalendarLabelSummary => {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const label = value as Partial<CalendarLabelSummary>;
  return (
    typeof label.id === "string" &&
    label.id.length > 0 &&
    typeof label.value === "string" &&
    isPositiveInteger(label.projectId)
  );
};

const isCalendarProjectV1 = (value: unknown): value is CalendarProjectV1 => {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const project = value as Partial<CalendarProjectV1>;
  return (
    isPositiveInteger(project.id) &&
    typeof project.name === "string" &&
    (typeof project.title === "string" || project.title === null) &&
    Array.isArray(project.members) &&
    project.members.every(
      (member) =>
        member != null &&
        typeof member === "object" &&
        isCalendarUserSummary(member.user),
    ) &&
    Array.isArray(project.labels) &&
    project.labels.every(
      (label) =>
        isCalendarLabelSummary(label) && label.projectId === project.id,
    ) &&
    project._count != null &&
    Number.isInteger(project._count.tasks) &&
    project._count.tasks >= 0
  );
};

const isCalendarAgentSummary = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  typeof value.displayName === "string" &&
  (typeof value.photoURL === "string" || value.photoURL === null);

const isCalendarTaskProject = (value: unknown, projectId: number): boolean =>
  isRecord(value) &&
  value.id === projectId &&
  typeof value.name === "string" &&
  isNullableString(value.title);

const isCalendarAssignee = (value: unknown): boolean =>
  isRecord(value) &&
  isPositiveInteger(value.id) &&
  isPositiveInteger(value.userId) &&
  isCalendarUserSummary(value.user) &&
  (value.agentId === null ||
    (typeof value.agentId === "string" && value.agentId.length > 0)) &&
  (value.agent === null || isCalendarAgentSummary(value.agent)) &&
  ((value.agentId === null && value.agent === null) ||
    (typeof value.agentId === "string" &&
      isRecord(value.agent) &&
      value.agent.id === value.agentId));

const isCalendarPriority = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    Number.isInteger(value.priority_index) &&
    typeof value.Priority_Value === "string");

const isCalendarEstimate = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    Number.isInteger(value.estimate_index) &&
    typeof value.estimate_value === "string");

const isCalendarTaskLabel = (
  value: unknown,
  taskId: number,
  projectId: number,
): boolean =>
  isRecord(value) &&
  isPositiveInteger(value.id) &&
  value.taskId === taskId &&
  typeof value.labelId === "string" &&
  isCalendarLabelSummary(value.label) &&
  value.labelId === value.label.id &&
  value.label.projectId === projectId;

const isCalendarTaskV1 = (value: unknown): value is CalendarTaskV1 => {
  if (!isRecord(value)) return false;
  const id = value.id;
  const projectId = value.projectId;
  if (!isPositiveInteger(id) || !isPositiveInteger(projectId)) return false;

  return (
    isPositiveInteger(value.uniqueIndex) &&
    isNullableString(value.ticketNumber) &&
    typeof value.ranking === "string" &&
    typeof value.section === "string" &&
    isNullablePositiveInteger(value.sectionId) &&
    typeof value.title === "string" &&
    value.status === "Normal" &&
    isPositiveInteger(value.userId) &&
    isDateValue(value.createdAt) &&
    isDateValue(value.updatedAt) &&
    isDateValue(value.dueDate) &&
    isNullableDateValue(value.startDate) &&
    isNullableString(value.recurrence) &&
    value.deletedAt === null &&
    isNullablePositiveInteger(value.waitingOnUserId) &&
    (value.waitingOnUser === null ||
      (isCalendarUserSummary(value.waitingOnUser) &&
        value.waitingOnUser.id === value.waitingOnUserId)) &&
    (value.agentId === null ||
      (typeof value.agentId === "string" && value.agentId.length > 0)) &&
    Array.isArray(value.updatedByUserIds) &&
    value.updatedByUserIds.every(isPositiveInteger) &&
    isCalendarTaskProject(value.project, projectId) &&
    Array.isArray(value.assignees) &&
    value.assignees.every(isCalendarAssignee) &&
    isCalendarPriority(value.priority) &&
    isCalendarEstimate(value.estimate) &&
    Array.isArray(value.taskLabels) &&
    value.taskLabels.every((taskLabel) =>
      isCalendarTaskLabel(taskLabel, id, projectId),
    ) &&
    isRecord(value._count) &&
    isNonNegativeInteger(value._count.comments) &&
    isNonNegativeInteger(value._count.savedContent)
  );
};

export const containsUnsafeCalendarIdentity = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsUnsafeCalendarIdentity);

  for (const [key, nested] of Object.entries(value)) {
    if (
      (key === "user" ||
        key === "owner" ||
        key === "agent" ||
        key === "waitingOnUser") &&
      nested &&
      typeof nested === "object" &&
      !Array.isArray(nested) &&
      Object.keys(nested).some(
        (identityKey) =>
          !(key === "agent" ? SAFE_AGENT_KEYS : SAFE_USER_KEYS).has(
            identityKey,
          ),
      )
    ) {
      return true;
    }
    if (containsUnsafeCalendarIdentity(nested)) return true;
  }
  return false;
};

const reviveDate = (value: unknown): Date | undefined => {
  if (value == null) return undefined;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(date.getTime()) ? date : undefined;
};

export const rehydrateCalendarTask = (
  task: CalendarTaskV1,
): CalendarTaskV1 => ({
  ...task,
  dueDate: reviveDate(task.dueDate),
  startDate: reviveDate(task.startDate),
  permanentlyDeleteAt: reviveDate(task.permanentlyDeleteAt) as Date,
});

export const calendarReadModelKey = (
  accountId: number,
  range: Pick<
    CalendarVisibleRange,
    "timezone" | "rangeStart" | "rangeEndExclusive"
  >,
) =>
  `${CALENDAR_READ_MODEL_SCHEMA_VERSION}:${accountId}:${encodeURIComponent(range.timezone)}:${range.rangeStart}:${range.rangeEndExclusive}`;

export const isCalendarReadModelSnapshotV1 = (
  value: unknown,
  expected?: {
    accountId: number;
    authorizationRevision?: string;
    range: CalendarVisibleRange;
    nowMs?: number;
  },
): value is CalendarReadModelSnapshotV1 => {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const snapshot = value as Partial<CalendarReadModelSnapshotV1>;
  const range = validateCalendarVisibleRange({
    rangeStart: snapshot.rangeStart ?? "",
    rangeEndExclusive: snapshot.rangeEndExclusive ?? "",
    startIso: snapshot.startIso ?? "",
    endExclusiveIso: snapshot.endExclusiveIso ?? "",
    timezone: snapshot.timezone ?? "",
  });
  if (
    snapshot.contractVersion !== CALENDAR_SYNC_CONTRACT_VERSION ||
    snapshot.schemaVersion !== CALENDAR_READ_MODEL_SCHEMA_VERSION ||
    !isPositiveInteger(snapshot.accountId) ||
    typeof snapshot.authorizationRevision !== "string" ||
    !range ||
    snapshot.key !== calendarReadModelKey(snapshot.accountId, range) ||
    typeof snapshot.savedAt !== "string" ||
    typeof snapshot.expiresAt !== "string" ||
    typeof snapshot.retrievedAt !== "string" ||
    !Array.isArray(snapshot.taskOrder) ||
    !snapshot.tasksById ||
    Array.isArray(snapshot.tasksById) ||
    typeof snapshot.tasksById !== "object" ||
    !Array.isArray(snapshot.projectOrder) ||
    !snapshot.projectsById ||
    Array.isArray(snapshot.projectsById) ||
    typeof snapshot.projectsById !== "object" ||
    containsUnsafeCalendarIdentity(snapshot)
  ) {
    return false;
  }

  const nowMs = expected?.nowMs ?? Date.now();
  if (
    !Number.isFinite(Date.parse(snapshot.savedAt)) ||
    !Number.isFinite(Date.parse(snapshot.retrievedAt)) ||
    !Number.isFinite(Date.parse(snapshot.expiresAt)) ||
    Date.parse(snapshot.expiresAt) !==
      Date.parse(snapshot.retrievedAt) + CALENDAR_READ_MODEL_TTL_MS ||
    Date.parse(snapshot.expiresAt) <= nowMs
  ) {
    return false;
  }
  if (
    expected &&
    (snapshot.accountId !== expected.accountId ||
      snapshot.key !==
        calendarReadModelKey(expected.accountId, expected.range) ||
      (expected.authorizationRevision != null &&
        snapshot.authorizationRevision !== expected.authorizationRevision) ||
      snapshot.startIso !== expected.range.startIso ||
      snapshot.endExclusiveIso !== expected.range.endExclusiveIso)
  ) {
    return false;
  }

  const projectIds = new Set(snapshot.projectOrder);
  if (
    projectIds.size !== snapshot.projectOrder.length ||
    Object.keys(snapshot.projectsById).length !==
      snapshot.projectOrder.length ||
    !snapshot.projectOrder.every((projectId) => {
      const project = snapshot.projectsById?.[String(projectId)];
      return (
        isPositiveInteger(projectId) &&
        isCalendarProjectV1(project) &&
        project.id === projectId
      );
    }) ||
    !Object.entries(snapshot.projectsById).every(
      ([projectId, project]) =>
        String(project?.id) === projectId && projectIds.has(project.id),
    )
  ) {
    return false;
  }
  if (
    buildCalendarAuthorizationRevision(snapshot.projectOrder) !==
    snapshot.authorizationRevision
  ) {
    return false;
  }
  if (
    Object.values(snapshot.tasksById).some(
      (task) => !isCalendarTaskV1(task),
    )
  ) {
    return false;
  }

  const rangeStart = new Date(range.startIso);
  const rangeEndExclusive = new Date(range.endExclusiveIso);
  const taskIds = new Set(snapshot.taskOrder);
  if (
    taskIds.size !== snapshot.taskOrder.length ||
    Object.keys(snapshot.tasksById).length !== snapshot.taskOrder.length ||
    !Object.entries(snapshot.tasksById).every(
      ([taskId, task]) => String(task?.id) === taskId && taskIds.has(task.id),
    )
  ) {
    return false;
  }
  return snapshot.taskOrder.every((taskId) => {
    const task = snapshot.tasksById?.[String(taskId)];
    return (
      isPositiveInteger(taskId) &&
      isCalendarTaskV1(task) &&
      task?.id === taskId &&
      task.deletedAt == null &&
      isPositiveInteger(task.projectId) &&
      projectIds.has(task.projectId) &&
      calendarTaskOverlapsRange(task, rangeStart, rangeEndExclusive)
    );
  });
};

export const shouldReplaceCalendarReadModelSnapshot = (
  existing: unknown,
  candidate: CalendarReadModelSnapshotV1,
): boolean => {
  if (!isCalendarReadModelSnapshotV1(candidate)) return false;
  if (!isCalendarReadModelSnapshotV1(existing)) return true;
  return Date.parse(candidate.retrievedAt) > Date.parse(existing.retrievedAt);
};

export const createCalendarReadModelSnapshot = ({
  payload,
  savedAt = new Date().toISOString(),
}: {
  payload: CalendarSyncPayloadV1;
  savedAt?: string;
}): CalendarReadModelSnapshotV1 | null => {
  const range = isRecord(payload) ? validateCalendarVisibleRange(payload) : null;
  if (
    !isRecord(payload) ||
    !isPositiveInteger(payload.accountId) ||
    !range ||
    typeof payload.authorizationRevision !== "string" ||
    !isDateValue(payload.retrievedAt) ||
    !Array.isArray(payload.projects) ||
    !Array.isArray(payload.tasks) ||
    !isDateValue(savedAt) ||
    containsUnsafeCalendarIdentity(payload)
  ) {
    return null;
  }

  const projectsById: Record<string, CalendarProjectV1> = {};
  const projectOrder: number[] = [];
  for (const project of payload.projects) {
    if (!isCalendarProjectV1(project)) return null;
    const key = String(project.id);
    if (key in projectsById) return null;
    projectOrder.push(project.id);
    projectsById[key] = project;
  }
  if (
    buildCalendarAuthorizationRevision(projectOrder) !==
    payload.authorizationRevision
  ) {
    return null;
  }

  const rangeStart = new Date(range.startIso);
  const rangeEndExclusive = new Date(range.endExclusiveIso);
  const tasksById: Record<string, CalendarTaskV1> = {};
  const taskOrder: number[] = [];
  for (const candidate of payload.tasks) {
    const task = normalizeCalendarTaskForSnapshot(candidate);
    if (!isCalendarTaskV1(task)) return null;
    if (
      !isPositiveInteger(task?.id) ||
      task.status !== "Normal" ||
      task.deletedAt != null ||
      !isPositiveInteger(task.projectId) ||
      !(String(task.projectId) in projectsById) ||
      !calendarTaskOverlapsRange(task, rangeStart, rangeEndExclusive)
    ) {
      continue;
    }
    const key = String(task.id);
    if (key in tasksById) return null;
    taskOrder.push(task.id);
    tasksById[key] = task;
  }

  return {
    ...range,
    key: calendarReadModelKey(payload.accountId, range),
    contractVersion: CALENDAR_SYNC_CONTRACT_VERSION,
    schemaVersion: CALENDAR_READ_MODEL_SCHEMA_VERSION,
    accountId: payload.accountId,
    authorizationRevision: payload.authorizationRevision,
    savedAt,
    expiresAt: new Date(
      Date.parse(payload.retrievedAt) + CALENDAR_READ_MODEL_TTL_MS,
    ).toISOString(),
    retrievedAt: payload.retrievedAt,
    taskOrder,
    tasksById,
    projectOrder,
    projectsById,
  };
};

export const materializeCalendarReadModelSnapshot = (
  snapshot: CalendarReadModelSnapshotV1,
): CalendarSyncPayloadV1 => ({
  accountId: snapshot.accountId,
  authorizationRevision: snapshot.authorizationRevision,
  rangeStart: snapshot.rangeStart,
  rangeEndExclusive: snapshot.rangeEndExclusive,
  startIso: snapshot.startIso,
  endExclusiveIso: snapshot.endExclusiveIso,
  timezone: snapshot.timezone,
  retrievedAt: snapshot.retrievedAt,
  tasks: snapshot.taskOrder.map((taskId) =>
    rehydrateCalendarTask(snapshot.tasksById[String(taskId)]),
  ),
  projects: snapshot.projectOrder.map(
    (projectId) => snapshot.projectsById[String(projectId)],
  ),
});
