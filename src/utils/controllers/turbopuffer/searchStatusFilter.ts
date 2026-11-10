export type SearchStatus = "Normal" | "Archive" | "Deleted";

export const TRASHED_STATUSES: SearchStatus[] = ["Deleted"];
export const NON_LIVE_STATUSES: SearchStatus[] = ["Deleted", "Archive"];

export function buildSearchStatusFilter(
  field: string,
  status?: SearchStatus | null,
  excludeStatuses: SearchStatus[] = TRASHED_STATUSES
): unknown[] | null {
  if (status) return [field, "Eq", status];

  const excluded = excludeStatuses.filter(
    (value, index) => excludeStatuses.indexOf(value) === index
  );
  if (excluded.length === 0) return null;

  const rejections = excluded.map((value) => [field, "NotEq", value]);
  return rejections.length === 1 ? rejections[0] : ["And", rejections];
}
