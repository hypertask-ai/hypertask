type ReminderRevisionSource = {
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  remindAt?: Date | string | null;
};

function timestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Returns a write revision that is newer than every reminder observed while
 * holding the task advisory lock. This makes the persisted updatedAt value a
 * monotonic queue revision even when concurrent requests start in one millisecond.
 */
export function nextReminderRevision(
  reminders: ReminderRevisionSource[],
  clock: () => number = Date.now
): Date {
  const previous = reminders.reduce(
    (latest, reminder) => Math.max(
      latest,
      timestamp(reminder.updatedAt),
      timestamp(reminder.createdAt),
      timestamp(reminder.remindAt)
    ),
    0
  );
  return new Date(Math.max(clock(), previous + 1));
}
