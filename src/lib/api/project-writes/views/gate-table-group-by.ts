import { isFeatureEnabled } from "@/lib/flags";
import { sanitizeTableGroupBy, sanitizeTableGrouping } from "@/lib/table-view/tableGroupByTag";

const TABLE_GROUP_BY_TAG_FLAG = "htpr-8630-table-group-by-tag";

export async function gatedTableGroupByForViewWrite(value: unknown, userId: number): Promise<string | null> {
  const sanitized = sanitizeTableGrouping(value);
  if (!sanitized) return sanitized;
  const mode = sanitizeTableGroupBy(sanitized);
  if (mode && mode !== "column" && !(await isFeatureEnabled(TABLE_GROUP_BY_TAG_FLAG, userId))) {
    return "column";
  }
  return sanitized;
}
