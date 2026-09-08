/**
 * Reads the SSE error frame from a refused AI chat stream response.
 *
 * The stream route returns non-OK statuses with a real message inside the body
 * (409 busy, 429 limited, 503 unavailable — see createSseErrorResponse), but a
 * client that only checks response.ok shows all of them as "Connection lost"
 * (HTPR-6278). Returns null when the body carries no usable error message.
 */
export function extractSseErrorMessage(bodyText: string): string | null {
  let eventType = "";
  for (const line of bodyText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("event:")) {
      eventType = trimmed.slice(6).trim();
      continue;
    }
    if (eventType !== "error" || !trimmed.startsWith("data:")) continue;
    try {
      const parsed = JSON.parse(trimmed.slice(5).trim()) as {
        content?: unknown;
      };
      if (typeof parsed.content === "string" && parsed.content.trim()) {
        return parsed.content;
      }
    } catch {
      // A malformed frame carries no message; keep scanning.
    }
    eventType = "";
  }
  return null;
}

export async function extractStreamRefusalMessage(
  response: Response,
): Promise<string | null> {
  try {
    return extractSseErrorMessage(await response.text());
  } catch {
    return null;
  }
}
