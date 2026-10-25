export type FeedbackRefusal = { code?: string; field?: string; options?: readonly unknown[] };

const CALLER_FIXABLE_CODES = new Set(["unrecognized_keys", "invalid_enum_value", "invalid_value", "invalid_type", "invalid_literal", "too_small", "too_big"]);

export function callerCanFix(refusal: FeedbackRefusal): boolean {
  if (!refusal.code) return false;
  if (!CALLER_FIXABLE_CODES.has(refusal.code)) return false;
  if (refusal.code === "unrecognized_keys" || refusal.code === "invalid_enum_value" || refusal.code === "invalid_value") return true;
  return Boolean(refusal.field);
}

export function refusalFromZodIssues(issues: readonly { code: string; path?: readonly (string | number)[]; keys?: readonly string[]; options?: readonly unknown[] }[]): FeedbackRefusal {
  const issue = issues[0];
  if (!issue) return {};
  const field = issue.code === "unrecognized_keys" ? issue.keys?.[0] : issue.path?.filter((part) => typeof part === "string").join(".") || undefined;
  return {
    code: issue.code,
    ...(field ? { field } : {}),
    ...(issue.options && issue.options.length ? { options: issue.options } : {}),
  };
}

export const RECENTLY_FILED_HOURS = 24;

export function filedWithinLastDay(filedAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!filedAt) return false;
  const time = new Date(filedAt).getTime();
  if (Number.isNaN(time)) return false;
  return now.getTime() - time < RECENTLY_FILED_HOURS * 60 * 60 * 1000;
}
