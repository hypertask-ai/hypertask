export const RETENTION_LIMIT = 3;

export const boardRetentionEvictionKeys = (
  otherRecords: { key: string; recency: string }[],
  keptKey: string,
  limit: number = RETENTION_LIMIT,
): string[] =>
  otherRecords
    .filter((record) => record.key !== keptKey)
    .sort((a, b) => (a.recency < b.recency ? 1 : a.recency > b.recency ? -1 : 0))
    .slice(Math.max(0, limit - 1))
    .map((record) => record.key);
