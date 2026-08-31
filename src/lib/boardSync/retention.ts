// HTPR-5753: pure retention decision for the board read-model store, split
// out of indexedDbReadModel.ts so it's importable without that module's
// BroadcastChannel side effect (opening it hangs a plain Node process).
export const RETENTION_LIMIT = 3;

/**
 * Given every other record for the account, which keys fall outside the
 * retention budget once `keptKey` (the board just written) takes one of the
 * slots? A record with no readable recency (`""`) sorts oldest and is
 * evicted first. Revocation stubs rank on `revokedAt` exactly like snapshots
 * rank on `savedAt` -- nothing here treats them specially, so an aged-out
 * stub is evicted the same way an aged-out snapshot is.
 */
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
