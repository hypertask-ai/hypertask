export type FeedbackRefusal = { code?: string; field?: string; options?: readonly unknown[] };

const CALLER_FIXABLE_CODES = new Set(["unrecognized_keys", "invalid_enum_value", "invalid_value", "invalid_type", "invalid_literal", "invalid_format", "too_small", "too_big"]);

export function callerCanFix(refusal: FeedbackRefusal): boolean {
  if (!refusal.code) return false;
  if (!CALLER_FIXABLE_CODES.has(refusal.code)) return false;
  if (refusal.code === "unrecognized_keys" || refusal.code === "invalid_enum_value" || refusal.code === "invalid_value") return true;
  return Boolean(refusal.field);
}

export function callerCanFixRefusal(details: FeedbackRefusal | undefined, status: number): boolean {
  return status < 500 && callerCanFix(details ?? {});
}

export const RECENTLY_FILED_HOURS = 24;

export function filedWithinLastDay(filedAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!filedAt) return false;
  const time = new Date(filedAt).getTime();
  if (Number.isNaN(time)) return false;
  return now.getTime() - time < RECENTLY_FILED_HOURS * 60 * 60 * 1000;
}

export function filedRecently<T extends { createdAt: Date | string }>(ticket: T | null | undefined, now: Date = new Date()): ticket is T {
  return filedWithinLastDay(ticket?.createdAt, now);
}

export async function quietFixableReports(userId?: number): Promise<boolean> {
  try {
    const [{ isFeatureEnabled }, { HTPR_7941_QUIET_FIXABLE_REPORTS_FLAG }] = await Promise.all([
      import("@/lib/flags"),
      import("@/lib/flags/definitions/htpr-7941-quiet-fixable-reports"),
    ]);
    return await isFeatureEnabled(HTPR_7941_QUIET_FIXABLE_REPORTS_FLAG, userId ?? Number(process.env.AI_FEEDBACK_AGENT_USER_ID));
  } catch {
    return false;
  }
}
