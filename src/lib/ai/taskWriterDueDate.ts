import { parse } from "node-html-parser";
import { defaultHour, defaultMinutes } from "@/lib/constants/constants";
import { parseIanaTimeZone, wallTimeInTimeZone } from "@/lib/myTasksTimeZone";

const MARKER = "ai-generated-task-due-date";

export function taskWriterDateContext(timeZone?: string | null, now = new Date()) {
  const zone = parseIanaTimeZone(timeZone) ?? "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return { today: `${value("year")}-${value("month")}-${value("day")}`, timeZone: zone };
}

// Accept a real calendar date from today through two years ahead; anything else gives no due date.
export function validateTaskWriterDueDate(value: unknown, today: string): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  const limit = `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`;
  return value >= today && value <= limit ? value : undefined;
}

export function taskWriterDueDateInstructions(context: ReturnType<typeof taskWriterDateContext>) {
  return `Today's local date is ${context.today}. The user's time zone is ${context.timeZone}.
Set the due date (YYYY-MM-DD) only when the user explicitly asks for a deadline for that task, as <span id="${MARKER}" style="display:none">YYYY-MM-DD</span> after the description. Never set it when the user negates it ("not due", "no deadline"). Resolve relative dates against today and the time zone above. A date mentioned for another reason (history, notes) is not a deadline.`;
}

// The model's own date, validated. The marker is removed and re-added only when the date is valid.
export function applyTaskWriterDueDate(html: string, context: ReturnType<typeof taskWriterDateContext>) {
  const root = parse(html);
  const markers = root.querySelectorAll(`#${MARKER}`);
  const dueDate = validateTaskWriterDueDate(markers[0]?.textContent.trim(), context.today);
  markers.forEach((marker) => marker.remove());
  return { dueDate, html: root.toString() + (dueDate ? `<span id="${MARKER}" style="display:none">${dueDate}</span>` : "") };
}

export function taskWriterDueDateForSave(value: unknown, timeZone?: string | null, now = new Date()): Date | undefined {
  const context = taskWriterDateContext(timeZone, now);
  const iso = validateTaskWriterDueDate(value, context.today);
  if (!iso) return undefined;
  const [year, month, day] = iso.split("-").map(Number);
  return wallTimeInTimeZone(context.timeZone, year, month, day, defaultHour, defaultMinutes);
}
