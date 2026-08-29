const NON_STATE_MUTATION_KEYS = new Set([
  "id",
  "updatedAt",
  "archivedAt",
  "deletedAt",
]);

function mutationValuesEqual(current: unknown, requested: unknown): boolean {
  if (current === requested) return true;

  if (current instanceof Date || requested instanceof Date) {
    const currentTime = new Date(current as string | number | Date).getTime();
    const requestedTime = new Date(
      requested as string | number | Date,
    ).getTime();
    return Number.isFinite(currentTime) && currentTime === requestedTime;
  }

  if (
    current !== null &&
    requested !== null &&
    typeof current === "object" &&
    typeof requested === "object"
  ) {
    if (Array.isArray(current) || Array.isArray(requested)) {
      return (
        Array.isArray(current) &&
        Array.isArray(requested) &&
        current.length === requested.length &&
        current.every((value, index) =>
          mutationValuesEqual(value, requested[index]),
        )
      );
    }

    const currentRecord = current as Record<string, unknown>;
    const requestedRecord = requested as Record<string, unknown>;
    const currentKeys = Object.keys(currentRecord).sort();
    const requestedKeys = Object.keys(requestedRecord).sort();
    return (
      currentKeys.length === requestedKeys.length &&
      currentKeys.every(
        (key, index) =>
          key === requestedKeys[index] &&
          mutationValuesEqual(currentRecord[key], requestedRecord[key]),
      )
    );
  }

  return false;
}

/**
 * Returns true only when a caller-requested task field differs from the task
 * state read while holding the mutation fence. Server-generated timestamps do
 * not turn a duplicate/no-op request into a human override.
 */
export function hasRequestedTaskStateChange(
  currentTask: Record<string, unknown>,
  requestedTask: Record<string, unknown>,
): boolean {
  return Object.entries(requestedTask).some(([key, requested]) => {
    if (requested === undefined || NON_STATE_MUTATION_KEYS.has(key))
      return false;
    return !mutationValuesEqual(currentTask[key], requested);
  });
}

/**
 * Converts a possibly full task snapshot into the fields the person actually
 * changed. This is calculated before waiting on the mutation fence, so a
 * later agent write cannot be restored accidentally when the human wins the
 * lease race.
 */
export function requestedTaskStateChanges(
  taskAtRequestTime: Record<string, unknown>,
  requestedTask: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(requestedTask).filter(([key, requested]) => {
      if (requested === undefined || NON_STATE_MUTATION_KEYS.has(key)) {
        return false;
      }
      return !mutationValuesEqual(taskAtRequestTime[key], requested);
    }),
  );
}

export function taskLifecycleTimestampChanges(
  requestedStatus: unknown,
  changedAt: Date,
): Record<string, Date | null> {
  if (requestedStatus === "Archive") {
    return { archivedAt: changedAt, deletedAt: null };
  }
  if (requestedStatus === "Deleted") {
    return { archivedAt: null, deletedAt: changedAt };
  }
  if (requestedStatus === "Normal") {
    return { archivedAt: null, deletedAt: null };
  }
  return {};
}

export function normalizeRequestedTaskMutation(
  requestedTask: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...requestedTask };
  if (normalized.parentTaskId === normalized.id) normalized.parentTaskId = null;
  if (normalized.description === null) normalized.description = "";
  return normalized;
}
