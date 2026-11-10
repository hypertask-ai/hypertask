import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8972_TABLE_GROUP_FOLD_FLAG } from "@/lib/flags/definitions/htpr-8972-table-group-fold";
import { sanitizeTableCollapsedSectionsForWrite } from "@/lib/table-view/tableCollapsedSections";

export async function gatedTableCollapsedSectionsForViewWrite(
  value: unknown,
  userId: number,
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (!(await isFeatureEnabled(HTPR_8972_TABLE_GROUP_FOLD_FLAG, userId))) return null;
  return sanitizeTableCollapsedSectionsForWrite(value);
}
