import { isFeatureEnabled } from "@/lib/flags";
import { sanitizeTableGroupBy, sanitizeTableGrouping } from "@/lib/table-view/tableGroupByTag";

export async function gatedTableGroupByForViewWrite(value: unknown, userId: number): Promise<string | null> {
  const sanitized = sanitizeTableGrouping(value);
  if (!sanitized) return sanitized;
  const mode = sanitizeTableGroupBy(sanitized);
  if (!mode || mode === "column") return sanitized;
  const flag = sanitized === "tag" ? "htpr-8630-table-group-by-tag" : "htpr-8974-table-group-modes";
  return (await isFeatureEnabled(flag, userId)) ? sanitized : "column";
}
