export function timeEntryCreatedInvalidationKeys(taskId: number) {
  return [
    ["time", "report"],
    ["time", "task", taskId],
    ["time", "entries", taskId],
    ["time", "running"],
    ["time", "running-board"],
  ] as const;
}
