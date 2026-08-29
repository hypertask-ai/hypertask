export type InboxSplitKey = `project:${number}` | `system:${string}`;

export type InboxSplitIdentity = {
  project: string;
  projectId?: number | null;
};

export const getInboxSplitKey = ({
  project,
  projectId,
}: InboxSplitIdentity): InboxSplitKey =>
  projectId != null ? `project:${projectId}` : `system:${project}`;

export const isInboxSplitKey = (value: unknown): value is InboxSplitKey => {
  if (typeof value !== "string" || value.length > 200) return false;

  if (value.startsWith("project:")) return /^project:[1-9]\d*$/.test(value);

  return value.startsWith("system:") && value.length > "system:".length;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const getSplitsNoImportant = (notificationMatrix: unknown): InboxSplitKey[] => {
  const value = asRecord(notificationMatrix).splitsNoImportant;
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(value.filter(isInboxSplitKey)));
};

export const getShowImportantSplit = (notificationMatrix: unknown): boolean =>
  asRecord(notificationMatrix).showImportantSplit === true;

export const withSplitsNoImportant = (
  notificationMatrix: unknown,
  splitsNoImportant: readonly InboxSplitKey[]
): Record<string, unknown> => ({
  ...asRecord(notificationMatrix),
  splitsNoImportant: Array.from(new Set(splitsNoImportant)),
});
