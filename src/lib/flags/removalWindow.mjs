export const FEATURE_FLAG_REMOVAL_DAYS = 14;
export const BUGFIX_FLAG_REMOVAL_DAYS = 7;
export const FLAG_REMOVAL_TICKETS_PER_RUN = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_WINDOW_HIGH_RISKS = new Set(["money", "access", "data-deletion"]);

export function removalWindowDays(flag) {
  if (flag.highRisk && LONG_WINDOW_HIGH_RISKS.has(flag.highRisk)) return FEATURE_FLAG_REMOVAL_DAYS;
  if (flag.kind === "bugfix") return BUGFIX_FLAG_REMOVAL_DAYS;
  return FEATURE_FLAG_REMOVAL_DAYS;
}

export function selectDueFlags(rows, now = new Date()) {
  return rows.filter((row) => {
    if (row.mode !== "EVERYONE" || row.keep) return false;
    if (typeof row.removalTaskId === "number" && row.removalTaskId > 0) return false;
    const released = new Date(row.releasedAt ?? Number.NaN);
    if (Number.isNaN(released.getTime())) return false;
    return now.getTime() - released.getTime() >= removalWindowDays(row) * DAY_MS;
  }).sort((a, b) => {
    const delta = new Date(a.releasedAt ?? 0).getTime() - new Date(b.releasedAt ?? 0).getTime();
    if (delta !== 0) return delta;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
