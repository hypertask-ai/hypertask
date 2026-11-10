import { isFeatureEnabled } from "@/lib/flags";
import { sanitizeTableCollapsedSectionsForWrite } from "@/lib/table-view/tableGroupByTag";

export async function gatedTableCollapsedSectionsForViewWrite(
  value: unknown,
  userId: number,
): Promise<string | null> {
  if (!(await isFeatureEnabled("htpr-8972-table-group-fold", userId))) return null;
  return sanitizeTableCollapsedSectionsForWrite(value);
}
