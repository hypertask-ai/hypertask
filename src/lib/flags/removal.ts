import type { FeatureFlagRow } from "@/lib/flags";

export const FEATURE_FLAG_REMOVAL_DAYS = 14;

export const PENDING_REMOVAL_TASK_ID = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FeatureFlagRemovalState =
  | { kind: "counting"; days: number; label: string }
  | { kind: "due"; label: string }
  | { kind: "kept"; label: string }
  | { kind: "filed"; label: string };

export function featureFlagRemovalDueAt(row: {
  mode: FeatureFlagRow["mode"];
  releasedAt: Date | string | null;
}): Date | null {
  if (row.mode !== "EVERYONE" || !row.releasedAt) return null;
  const released = new Date(row.releasedAt);
  if (Number.isNaN(released.getTime())) return null;
  return new Date(released.getTime() + FEATURE_FLAG_REMOVAL_DAYS * DAY_MS);
}

export function featureFlagRemovalState(
  row: Pick<FeatureFlagRow, "mode" | "releasedAt" | "keep" | "removalTaskId">,
  now: Date = new Date(),
): FeatureFlagRemovalState | null {
  const dueAt = featureFlagRemovalDueAt(row);
  if (!dueAt) return null;
  if (typeof row.removalTaskId === "number" && row.removalTaskId > 0) {
    return { kind: "filed", label: "removal ticket filed" };
  }
  if (row.keep) return { kind: "kept", label: "kept" };
  const remainingMs = dueAt.getTime() - now.getTime();
  if (remainingMs <= 0) return { kind: "due", label: "due for removal" };
  const days = Math.ceil(remainingMs / DAY_MS);
  return { kind: "counting", days, label: `removed in ${days} ${days === 1 ? "day" : "days"}` };
}
