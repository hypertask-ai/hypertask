import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8630_TABLE_GROUP_BY_TAG_FLAG } from "@/lib/flags/definitions/htpr-8630-table-group-by-tag";
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
  if (sanitized === "tag" && !(await isFeatureEnabled(HTPR_8630_TABLE_GROUP_BY_TAG_FLAG, userId))) {
    return "column";
  }
  return sanitized;
}
