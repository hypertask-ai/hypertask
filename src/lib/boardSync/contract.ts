import type { IProject, ITask, IView } from "@/models/model";

export const BOARD_SYNC_CONTRACT_VERSION = 1 as const;
export const BOARD_READ_MODEL_SCHEMA_VERSION = 1 as const;

export type BoardSyncPayloadV1 = {
  project: IProject;
  tasks: ITask[];
  allViews: IView[];
};

export type BoardReadModelSnapshotV1 = {
  key: string;
  contractVersion: typeof BOARD_SYNC_CONTRACT_VERSION;
  schemaVersion: typeof BOARD_READ_MODEL_SCHEMA_VERSION;
  accountId: number;
  projectId: number;
  savedAt: string;
  project: IProject;
  taskOrder: number[];
  tasksById: Record<string, ITask>;
  allViews: IView[];
};

export const boardReadModelKey = (accountId: number, projectId: number) =>
  `${BOARD_READ_MODEL_SCHEMA_VERSION}:${accountId}:${projectId}`;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const isBoardReadModelSnapshotV1 = (
  value: unknown,
  expectedAccountId?: number,
  expectedProjectId?: number,
): value is BoardReadModelSnapshotV1 => {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const snapshot = value as Partial<BoardReadModelSnapshotV1>;
  if (
    snapshot.contractVersion !== BOARD_SYNC_CONTRACT_VERSION ||
    snapshot.schemaVersion !== BOARD_READ_MODEL_SCHEMA_VERSION ||
    !isPositiveInteger(snapshot.accountId) ||
    !isPositiveInteger(snapshot.projectId) ||
    snapshot.key !== boardReadModelKey(snapshot.accountId, snapshot.projectId) ||
    snapshot.project?.id !== snapshot.projectId ||
    !Array.isArray(snapshot.taskOrder) ||
    !snapshot.tasksById ||
    Array.isArray(snapshot.tasksById) ||
    typeof snapshot.tasksById !== "object" ||
    !Array.isArray(snapshot.allViews) ||
    typeof snapshot.savedAt !== "string"
  ) {
    return false;
  }
  if (expectedAccountId != null && snapshot.accountId !== expectedAccountId) {
    return false;
  }
  if (expectedProjectId != null && snapshot.projectId !== expectedProjectId) {
    return false;
  }
  return snapshot.taskOrder.every((taskId) => {
    const task = snapshot.tasksById?.[String(taskId)];
    return (
      isPositiveInteger(taskId) &&
      task?.id === taskId &&
      task.projectId === snapshot.projectId
    );
  });
};

export const createBoardReadModelSnapshot = ({
  accountId,
  projectId,
  payload,
  savedAt = new Date().toISOString(),
}: {
  accountId: number;
  projectId: number;
  payload: BoardSyncPayloadV1;
  savedAt?: string;
}): BoardReadModelSnapshotV1 | null => {
  if (
    !isPositiveInteger(accountId) ||
    !isPositiveInteger(projectId) ||
    payload.project?.id !== projectId
  ) {
    return null;
  }

  const tasksById: Record<string, ITask> = {};
  const taskOrder: number[] = [];
  for (const task of payload.tasks) {
    if (
      !isPositiveInteger(task?.id) ||
      task.projectId !== projectId
    ) {
      continue;
    }
    const taskKey = String(task.id);
    if (!(taskKey in tasksById)) taskOrder.push(task.id);
    tasksById[taskKey] = task;
  }

  // Sections and filteredSections are derived from tasks and the active view.
  // Recompute them after restore instead of persisting a second source of truth.
  const {
    tasks: _tasks,
    sections: _sections,
    filteredSections: _filteredSections,
    firstTask: _firstTask,
    ...project
  } = payload.project;

  return {
    key: boardReadModelKey(accountId, projectId),
    contractVersion: BOARD_SYNC_CONTRACT_VERSION,
    schemaVersion: BOARD_READ_MODEL_SCHEMA_VERSION,
    accountId,
    projectId,
    savedAt,
    project: project as IProject,
    taskOrder,
    tasksById,
    allViews: payload.allViews,
  };
};

export type BoardReadModelRevocationV1 = {
  key: string;
  accountId: number;
  projectId: number;
  revokedAt: string;
};

/**
 * A denied board is marked by overwriting its snapshot with this stub. It fails
 * snapshot validation, so every read path already treats it as "no snapshot",
 * and the marker is exactly as durable as the data it replaced.
 */
export const createBoardReadModelRevocation = (
  accountId: number,
  projectId: number,
  revokedAt: string = new Date().toISOString(),
): BoardReadModelRevocationV1 => ({
  key: boardReadModelKey(accountId, projectId),
  accountId,
  projectId,
  revokedAt,
});

/**
 * Deliberately an explicit shape check, not "fails snapshot validation": a
 * corrupt record must stay overwritable by a fresh snapshot.
 */
export const isBoardReadModelRevocationV1 = (
  value: unknown,
  expectedAccountId?: number,
  expectedProjectId?: number,
): value is BoardReadModelRevocationV1 => {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const revocation = value as Partial<BoardReadModelRevocationV1>;
  return (
    isPositiveInteger(revocation.accountId) &&
    isPositiveInteger(revocation.projectId) &&
    revocation.key ===
      boardReadModelKey(revocation.accountId, revocation.projectId) &&
    typeof revocation.revokedAt === "string" &&
    (expectedAccountId == null || revocation.accountId === expectedAccountId) &&
    (expectedProjectId == null || revocation.projectId === expectedProjectId)
  );
};

export const materializeBoardReadModelSnapshot = (
  snapshot: BoardReadModelSnapshotV1,
): BoardSyncPayloadV1 => ({
  project: snapshot.project,
  tasks: snapshot.taskOrder.map((taskId) => snapshot.tasksById[String(taskId)]),
  allViews: snapshot.allViews,
});
