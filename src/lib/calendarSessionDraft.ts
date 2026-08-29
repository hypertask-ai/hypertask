import {
  sanitizeCalendarViewsPreference,
  type CalendarEverythingOverride,
} from "../models/Calendar/model";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CalendarSessionDraft = {
  appliedViewId: string | null;
  state: CalendarEverythingOverride;
};

const calendarSessionDraftKey = (accountId: number) =>
  `hypertask:calendar-session-draft:${accountId}`;

const sanitizeCalendarSessionDraft = (
  value: unknown,
): CalendarSessionDraft | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (
    Object.keys(draft).length !== 2 ||
    !("appliedViewId" in draft) ||
    !("state" in draft) ||
    (draft.appliedViewId !== null && typeof draft.appliedViewId !== "string")
  ) {
    return null;
  }

  const preference = sanitizeCalendarViewsPreference({
    views: [],
    appliedViewId: draft.appliedViewId,
    everything: draft.state,
  });
  if (!preference?.everything) return null;

  return {
    appliedViewId: preference.appliedViewId,
    state: preference.everything,
  };
};

export const readCalendarSessionDraft = (
  storage: SessionStorageLike,
  accountId: number,
): CalendarSessionDraft | null => {
  const key = calendarSessionDraftKey(accountId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const draft = sanitizeCalendarSessionDraft(JSON.parse(raw));
    if (draft) return draft;
    storage.removeItem(key);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }
  return null;
};

export const writeCalendarSessionDraft = (
  storage: SessionStorageLike,
  accountId: number,
  draft: CalendarSessionDraft,
) => {
  try {
    storage.setItem(calendarSessionDraftKey(accountId), JSON.stringify(draft));
  } catch {
    // Session persistence is an enhancement; the Calendar remains usable.
  }
};

export const clearCalendarSessionDraft = (
  storage: SessionStorageLike,
  accountId: number,
) => {
  try {
    storage.removeItem(calendarSessionDraftKey(accountId));
  } catch {
    // Session persistence is an enhancement; the Calendar remains usable.
  }
};

export const resolveCalendarSessionDraft = (
  draft: CalendarSessionDraft | null,
  appliedViewId: string | null,
) => (draft?.appliedViewId === appliedViewId ? draft.state : null);
