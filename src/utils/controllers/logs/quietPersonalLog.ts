import { FEATURE_FLAG_OWNER_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7786_QUIET_PERSONAL_LOGS_FLAG } from "@/lib/flags/definitions/htpr-7786-quiet-personal-logs";
import { logRecord, recordId, type LogId } from "@/lib/logging/safeLog";

export { recordId };

export async function logPersonal(
  userId: number | null,
  label: string,
  ids: Record<string, LogId>,
  raw?: unknown,
) {
  const actor = typeof userId === "number" ? userId : FEATURE_FLAG_OWNER_USER_ID;
  let quiet = true;
  try {
    quiet = await isFeatureEnabled(HTPR_7786_QUIET_PERSONAL_LOGS_FLAG, actor);
  } catch {
    quiet = true;
  }
  try {
    if (quiet) {
      logRecord(label, ids, raw);
      return;
    }
    if (raw !== undefined) console.log(label, raw);
  } catch {
    try {
      console.log(label, ids);
    } catch {
      return;
    }
  }
}
