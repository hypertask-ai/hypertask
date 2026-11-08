import { isFeatureEnabled } from "@/lib/flags";
import {
  sanitizeTableGroupBy,
  type TableGroupBy,
} from "@/lib/table-view/tableGroupByTag";

export async function gatedTableGroupByForViewWrite(
  value: unknown,
  userId: number,
): Promise<TableGroupBy | null> {
  const sanitized = sanitizeTableGroupBy(value);
  if (!sanitized) return sanitized;
  if (sanitized === "tag" && !(await isFeatureEnabled("htpr-8630-table-group-by-tag", userId))) {
    return "column";
  }
  return sanitized;
}
