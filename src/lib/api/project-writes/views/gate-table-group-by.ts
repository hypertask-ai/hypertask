import { isFeatureEnabled } from "@/lib/flags";
import { sanitizeTableGrouping } from "@/lib/table-view/tableGroupByTag";

export async function gatedTableGroupByForViewWrite(value: unknown, userId: number): Promise<string | null> {
  const sanitized = sanitizeTableGrouping(value);
  if (!sanitized || sanitized === "column") return sanitized;
  const allowed = sanitized === "tag"
    ? await isFeatureEnabled("htpr-8630-table-group-by-tag", userId)
    : await isFeatureEnabled("htpr-8974-table-group-modes", userId);
  return allowed ? sanitized : "column";
}
