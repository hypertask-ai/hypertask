import type { FeatureFlagMode, FeatureFlagRow } from "@/lib/flags";
import { FEATURE_FLAG_RELEASE_RISKS, RELEASE_RISK_LABELS, RELEASE_RISK_ORDER } from "./releaseRisk";

export const NOT_YET_RELEASED_LABEL = "Not yet released";
export type FeatureFlagAudienceFilter = FeatureFlagMode | "ALL" | "UNRELEASED" | "PARKED";

export function isUnreleasedFeatureFlag(flag: Pick<FeatureFlagRow, "mode" | "parked">): boolean {
  return !flag.parked && (flag.mode === "OWNER_ONLY" || flag.mode === "OWNER_AND_QA");
}

export function countFeatureFlagsByAudience(
  flags: FeatureFlagRow[],
  unreleasedOnly = false,
): Record<FeatureFlagAudienceFilter, number> {
  const counts = {
    ALL: flags.length,
    UNRELEASED: 0,
    PARKED: 0,
    OWNER_ONLY: 0,
    OWNER_AND_QA: 0,
    EVERYONE: 0,
    OFF: 0,
  };
  for (const flag of flags) {
    counts[flag.mode]++;
    if (flag.parked) counts.PARKED++;
    else if (unreleasedOnly ? isUnreleasedFeatureFlag(flag) : flag.mode !== "EVERYONE") counts.UNRELEASED++;
  }
  return counts;
}

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

function clusterDate(flag: FeatureFlagRow, shippedOnly = false): Date | null {
  const shipped = flag.shippedOn ? localDay(flag.shippedOn) : null;
  if (shipped) return shipped;
  if (shippedOnly) return null;
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
 * Sorts flags by date and clusters them by calendar day.
 *
 * The date is the day the flag key first reached production. Every declared
 * flag carries one, and a stored key with no definition left behind by a removed flag falls
 * back to its `updatedAt`, which the database sets on write, so in practice the trailing
 * "Not yet released" cluster stays empty. The null handling below is still the honest
 * fallback for a row that somehow has neither date; do not remove it.
 */
export function clusterFeatureFlagsByReleaseDate(
  flags: FeatureFlagRow[],
  sortDirection: "asc" | "desc" | "risk",
  audienceFilter: FeatureFlagAudienceFilter,
  options: { shippedOnly?: boolean; unreleasedOnly?: boolean } = {},
): [string, FeatureFlagRow[]][] {
  const { shippedOnly = false, unreleasedOnly = false } = options;
  const filtered = flags.filter(
    (flag) => audienceFilter === "ALL" || (
      audienceFilter === "PARKED" ? !!flag.parked : audienceFilter === "UNRELEASED"
        ? (!flag.parked && (unreleasedOnly ? isUnreleasedFeatureFlag(flag) : flag.mode !== "EVERYONE"))
        : flag.mode === audienceFilter
    ),
  );
  const sorted = [...filtered].sort((a, b) => {
    if (sortDirection === "risk") {
      const rank = (flag: FeatureFlagRow) => {
        const risk = FEATURE_FLAG_RELEASE_RISKS[flag.key]?.risk;
        return risk ? RELEASE_RISK_ORDER.indexOf(risk) : RELEASE_RISK_ORDER.length;
      };
      const difference = rank(a) - rank(b);
      if (difference) return difference;
    }
    const aTime = clusterDate(a, shippedOnly)?.getTime() ?? null;
    const bTime = clusterDate(b, shippedOnly)?.getTime() ?? null;
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return sortDirection === "desc" ? bTime - aTime : aTime - bTime;
  });
  const grouped = new Map<string, FeatureFlagRow[]>();
  for (const flag of sorted) {
    const risk = FEATURE_FLAG_RELEASE_RISKS[flag.key]?.risk;
    const label = sortDirection === "risk"
      ? (risk ? RELEASE_RISK_LABELS[risk] : "Release risk not recorded")
      : dayLabel(clusterDate(flag, shippedOnly));
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
