import { isFeatureEnabled } from "@/lib/flags";
import { sanitizeTableGroupBy, sanitizeTableGrouping } from "@/lib/table-view/tableGroupByTag";

const TABLE_GROUP_BY_MODES_FLAG = "htpr-8974-table-group-modes";

export async function gatedTableGroupByForViewWrite(value: unknown, userId: number): Promise<string | null> {
  const sanitized = sanitizeTableGrouping(value);
  if (!sanitized) return sanitized;
  const mode = sanitizeTableGroupBy(sanitized);
  if (mode && mode !== "column" && !(await isFeatureEnabled(TABLE_GROUP_BY_MODES_FLAG, userId))) {
    return "column";
  }
  return sanitized;
}
