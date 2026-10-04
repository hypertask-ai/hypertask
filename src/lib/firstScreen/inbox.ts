import type { INotification } from "@/models/model";
import {
  getInitialInboxSplitIndex,
  type InboxSplitKey,
} from "@/lib/inboxSplitSettings";
import { getInboxTabs, resolveInboxStructuredData } from "@/utils/helperFunctions/inboxHelpers";

export function projectInboxFirstScreen({
  notifications, splitsNoImportant, showImportantSplit, now, locale, split, projectId,
}: {
  notifications: readonly INotification[];
  splitsNoImportant: readonly InboxSplitKey[];
  showImportantSplit: boolean;
  now: string;
  locale: string;
  split?: string;
  projectId?: string;
}) {
  // Categorization annotates rows. Never annotate the caller's request snapshot.
  const rows = notifications.map((row) => ({ ...row }));
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) throw new Error("Invalid first-screen clock");
  const compact = getInboxTabs(rows, splitsNoImportant, showImportantSplit, nowMs, locale);
  const structuredData = resolveInboxStructuredData(rows, compact);
  const selectedSplit = getInitialInboxSplitIndex({
    tabs: structuredData.tabs, split, projectId,
    urlSelectionProcessed: false, defaultSelectionProcessed: false,
  });
  return { notifications: rows, structuredData, selectedSplit };
}

// Match the existing local-midnight grouping, including its DST day-length rule.
export function projectInboxDateGroup(date: string, now: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric",
    minute: "numeric", second: "numeric", hourCycle: "h23",
  });
  const parts = (timestamp: number) => Object.fromEntries(
    formatter.formatToParts(timestamp).map(({ type, value }) => [type, Number(value)]),
  );
  const wallTime = (timestamp: number) => {
    const p = parts(timestamp);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  const midnight = (calendarDay: number) => {
    let result = calendarDay;
    for (let i = 0; i < 3; i++) result += calendarDay - wallTime(result);
    return result;
  };
  const day = (value: string) => {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new Error("Invalid first-screen date");
    const p = parts(timestamp);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  const today = day(now);
  const notificationDay = day(date);
  const daysDiff = Math.floor((midnight(today) - midnight(notificationDay)) / 86_400_000);
  if (daysDiff === 0) return "today";
  if (daysDiff === 1) return "yesterday";
  const weekday = new Date(today).getUTCDay();
  const monday = today - (weekday === 0 ? 6 : weekday - 1) * 86_400_000;
  if (notificationDay >= monday && notificationDay < today - 86_400_000) return "thisWeek";
  if (notificationDay >= monday - 7 * 86_400_000 && notificationDay <= monday - 86_400_000) return "lastWeek";
  const p = parts(new Date(date).getTime());
  return `${p.month - 1}-${p.year}`;
}
