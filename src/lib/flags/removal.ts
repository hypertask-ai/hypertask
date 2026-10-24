import type { FeatureFlagRow } from "@/lib/flags";
import { FEATURE_FLAG_DEFINITIONS } from "@/lib/flags/definitions";
import { removalWindowDays } from "@/lib/flags/removalWindow.mjs";

export { BUGFIX_FLAG_REMOVAL_DAYS, FEATURE_FLAG_REMOVAL_DAYS, removalWindowDays, selectDueFlags } from "@/lib/flags/removalWindow.mjs";

export const PENDING_REMOVAL_TASK_ID = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

const removalProfileByKey = new Map<string, { kind?: string; highRisk?: string }>(
  (FEATURE_FLAG_DEFINITIONS as readonly { key: string; kind?: string; releaseRisk?: { highRisk?: string } }[]).map((definition) => [
    definition.key,
    { kind: definition.kind, highRisk: definition.releaseRisk?.highRisk },
  ]),
);

export function removalProfile(key: string): { kind?: string; highRisk?: string } {
  return removalProfileByKey.get(key) ?? {};
}

export function removalWindowForFlag(row: {
  key?: string;
  kind?: string | null;
  highRisk?: string | null;
}): number {
  const profile = row.key ? removalProfileByKey.get(row.key) : undefined;
  return removalWindowDays({
    kind: row.kind ?? profile?.kind,
    highRisk: row.highRisk !== undefined ? row.highRisk : profile?.highRisk,
  });
}

export type FeatureFlagRemovalState =
  | { kind: "counting"; days: number; label: string }
  | { kind: "due"; label: string }
  | { kind: "kept"; label: string }
  | { kind: "filed"; label: string };

export function featureFlagRemovalDueAt(row: {
  key?: string;
  kind?: string | null;
  highRisk?: string | null;
  mode: FeatureFlagRow["mode"];
  releasedAt: Date | string | null;
}): Date | null {
  if (row.mode !== "EVERYONE" || !row.releasedAt) return null;
  const released = new Date(row.releasedAt);
  if (Number.isNaN(released.getTime())) return null;
  return new Date(released.getTime() + removalWindowForFlag(row) * DAY_MS);
}

export function featureFlagRemovalState(
  row: Pick<FeatureFlagRow, "key" | "kind" | "mode" | "releasedAt" | "keep" | "removalTaskId"> & {
    highRisk?: string | null;
  },
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
