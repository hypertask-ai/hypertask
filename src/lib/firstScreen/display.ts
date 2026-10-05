import type { FirstScreenDisplayPreferences } from "./contract";

type DisplayClock = { now: string; display: Pick<FirstScreenDisplayPreferences, "timeZone" | "locale"> };

export function projectDisplayDate(value: Date | string | null | undefined, clock: DisplayClock,
  style: "due" | "changed" | "created" | "relative" = "relative") {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const options = { timeZone: clock.display.timeZone };
  const part = (date: Date, name: "day" | "year") => date.toLocaleString("en-US", { ...options, [name]: "numeric" });
  const now = new Date(clock.now);
  const pastYear = part(date, "year") !== part(now, "year");
  const year = pastYear ? part(date, "year") : "";
  const month = date.toLocaleString(style === "relative" || style === "created" ? clock.display.locale : "en-US", { ...options, month: "short" });
  const day = part(date, "day").padStart(style === "relative" ? 1 : 2, "0");
  if (style === "due") return `${month} ${day}${year ? `, ${year}` : ""}`;
  if (style === "changed") return `${day} ${month}${year ? ` ${year}` : ""}`;
  if (style === "created") return date.toLocaleDateString(clock.display.locale, { ...options, day: "2-digit", month: "short", ...(pastYear ? { year: "numeric" as const } : {}) });
  const seconds = (now.getTime() - date.getTime()) / 1000;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 43200) return date.toLocaleString("en-US", { ...options, hour: "numeric", minute: "numeric", hour12: true });
  return `${day} ${month}${year ? ` ${year}` : ""}`;
}

export function projectDisplayDay(clock: DisplayClock) {
  return Number(new Date(clock.now).toLocaleString("en-US", { timeZone: clock.display.timeZone, day: "numeric" }));
}
