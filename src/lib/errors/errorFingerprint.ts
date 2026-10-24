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

const SECRET_PATTERNS = [
  /\b(?:bearer|basic)\s+[\w.~+/=-]{8,}/gi,
  /\b(?:sk|pk|rk|vck|xai|gsk|key|api|tok|token)[-_][\w-]{12,}/gi,
  /\b(?:api[-_]?key|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]{6,}/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) =>
      redacted.replace(pattern, (match, separator?: string) =>
        typeof separator === "string" && match.includes(separator)
          ? `${match.slice(0, match.indexOf(separator) + separator.length)}[redacted]`
          : "[redacted]",
      ),
    text,
  );
}

export function errorFingerprint(message: string, stack?: string) {
  const redactedMessage = redactSecrets(message);
  const redactedFrame = redactSecrets(firstMeaningfulStackFrame(stack));
  return createHash("sha256")
    .update(`${redactedMessage}\n${redactedFrame}`)
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
