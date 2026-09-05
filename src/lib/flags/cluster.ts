import type { FeatureFlagMode, FeatureFlagRow } from "@/lib/flags";

export const NOT_YET_RELEASED_LABEL = "Not yet released";

function releaseDateLabel(updatedAt: Date | null): string {
  if (!updatedAt) return NOT_YET_RELEASED_LABEL;
  return new Date(updatedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Sorts flags by release date (last mode change) and clusters them by
 * calendar day. Flags never touched (updatedAt === null) always land in a
 * trailing "Not yet released" cluster, regardless of sort direction.
 */
export function clusterFeatureFlagsByReleaseDate(
  flags: FeatureFlagRow[],
  sortDirection: "asc" | "desc",
  audienceFilter: FeatureFlagMode | "ALL",
): [string, FeatureFlagRow[]][] {
  const filtered = flags.filter(
    (flag) => audienceFilter === "ALL" || flag.mode === audienceFilter,
  );
  const sorted = [...filtered].sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return sortDirection === "desc" ? bTime - aTime : aTime - bTime;
  });
  const grouped = new Map<string, FeatureFlagRow[]>();
  for (const flag of sorted) {
    const label = releaseDateLabel(flag.updatedAt);
    const existing = grouped.get(label);
    if (existing) existing.push(flag);
    else grouped.set(label, [flag]);
  }
  const entries = [...grouped.entries()];
  entries.sort((a, b) => {
    if (a[0] === NOT_YET_RELEASED_LABEL) return 1;
    if (b[0] === NOT_YET_RELEASED_LABEL) return -1;
    return 0;
  });
  return entries;
}
