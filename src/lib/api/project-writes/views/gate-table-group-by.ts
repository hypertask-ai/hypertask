import { isFeatureEnabled } from "@/lib/flags";
import { sanitizeTableGrouping } from "@/lib/table-view/tableGroupByTag";

export async function gatedTableGroupByForViewWrite(value: unknown, userId: number): Promise<string | null> {
  const sanitized = sanitizeTableGrouping(value);
  if (!sanitized || sanitized === "column") return sanitized;
  if (sanitized === "tag" && await isFeatureEnabled("htpr-8630-table-group-by-tag", userId)) return sanitized;
  if (await isFeatureEnabled("htpr-8974-table-group-modes", userId)) return sanitized;
  return "column";
}
