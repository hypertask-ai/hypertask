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
