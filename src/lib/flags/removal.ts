import type { FeatureFlagRow } from "@/lib/flags";

/**
 * A flag left on Everyone becomes permanent code, so it gets two weeks before a dev is asked
 * to delete it and its dead branch (AGENTS.md, "Feature flags for new user-facing behavior").
 */
export const FEATURE_FLAG_REMOVAL_DAYS = 14;

/**
 * Written into `removalTaskId` while the sweep creates a flag's removal ticket. A route file may
 * not export anything but its handlers, so the marker lives here with the state it changes.
 */
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

/**
 * What the flags admin card says about removal, or null when the flag is not on Everyone and
 * so has no countdown at all. Keep wins over the countdown; a filed ticket wins over both,
 * because turning Keep on no longer un-files it.
 */
export function featureFlagRemovalState(
  row: Pick<FeatureFlagRow, "mode" | "releasedAt" | "keep" | "removalTaskId">,
  now: Date = new Date(),
): FeatureFlagRemovalState | null {
  const dueAt = featureFlagRemovalDueAt(row);
  if (!dueAt) return null;
  // Greater than zero, not just non-null: a row deserialised without the field, and the sweep's
  // in-flight claim of 0, must both keep showing the countdown rather than reading as filed.
  if (typeof row.removalTaskId === "number" && row.removalTaskId > 0) {
    return { kind: "filed", label: "removal ticket filed" };
  }
  if (row.keep) return { kind: "kept", label: "kept" };
  const remainingMs = dueAt.getTime() - now.getTime();
  if (remainingMs <= 0) return { kind: "due", label: "due for removal" };
  // Round up so the first day after the switch reads "removed in 14 days", not 13.
  const days = Math.ceil(remainingMs / DAY_MS);
  return { kind: "counting", days, label: `removed in ${days} ${days === 1 ? "day" : "days"}` };
}
