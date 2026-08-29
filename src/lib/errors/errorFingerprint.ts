import { createHash } from "node:crypto";

export const ERROR_TICKET_HOURLY_CAP = 5;

export function firstMeaningfulStackFrame(stack?: string) {
  if (!stack) return "";

  const lines = stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => /^at\s|@\S+:\d+/i.test(line)) ?? lines[1] ?? "";
}

export function errorFingerprint(message: string, stack?: string) {
  return createHash("sha256")
    .update(`${message}\n${firstMeaningfulStackFrame(stack)}`)
    .digest("hex");
}

export function isWithinErrorTicketCap(
  count: number,
  cap = ERROR_TICKET_HOURLY_CAP
) {
  return count <= cap;
}

export function errorTicketMinimumOccurrences(value?: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 1
    ? value
    : 1;
}
