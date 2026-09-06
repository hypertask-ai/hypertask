import type { FeatureFlagMode, FeatureFlagRow } from "@/lib/flags";

export const NOT_YET_RELEASED_LABEL = "Not yet released";

/**
 * `shippedOn` is a bare calendar day ("2026-09-04") with no timezone. Date.parse would read
 * it as UTC midnight and show the previous day to anyone west of UTC, so build local midnight
 * from the parts instead.
 */
function localDay(shippedOn: string): Date | null {
  const [year, month, day] = shippedOn.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function clusterDate(flag: FeatureFlagRow, byShipDate: boolean): Date | null {
  const shipped = byShipDate && flag.shippedOn ? localDay(flag.shippedOn) : null;
  if (shipped) return shipped;
  return flag.updatedAt ? new Date(flag.updatedAt) : null;
}

function dayLabel(date: Date | null): string {
  if (!date) return NOT_YET_RELEASED_LABEL;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Sorts flags by date and clusters them by calendar day. With `byShipDate` the date is the day
 * the flag key first reached production, which every declared flag has, so the trailing
 * "Not yet released" cluster cannot appear. Without it the date is the last mode change and
 * never-touched flags fall into that trailing cluster, in either sort direction.
 */
export function clusterFeatureFlagsByReleaseDate(
  flags: FeatureFlagRow[],
  sortDirection: "asc" | "desc",
  audienceFilter: FeatureFlagMode | "ALL",
  byShipDate = false,
): [string, FeatureFlagRow[]][] {
  const filtered = flags.filter(
    (flag) => audienceFilter === "ALL" || flag.mode === audienceFilter,
  );
  const sorted = [...filtered].sort((a, b) => {
    const aTime = clusterDate(a, byShipDate)?.getTime() ?? null;
    const bTime = clusterDate(b, byShipDate)?.getTime() ?? null;
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return sortDirection === "desc" ? bTime - aTime : aTime - bTime;
  });
  const grouped = new Map<string, FeatureFlagRow[]>();
  for (const flag of sorted) {
    const label = dayLabel(clusterDate(flag, byShipDate));
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
