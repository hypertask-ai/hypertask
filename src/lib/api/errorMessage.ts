// HTPR-5478: API error payloads travel through several hops before a CLI or
// MCP client prints them (controller -> pages route -> /api/mcp/* -> client).
// Any hop that drops an object into a string slot renders "[object Object]"
// and hides the real reason, so every hop unwraps the payload with this.
export function toErrorMessage(payload: unknown, fallback: string): string {
  const resolved = resolve(payload, 0);
  return resolved ?? fallback;
}

function resolve(payload: unknown, depth: number): string | null {
  if (depth > 4) return null;
  if (typeof payload === "string") {
    return payload.trim() ? payload : null;
  }
  if (payload instanceof Error) {
    return payload.message.trim() ? payload.message : null;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "details"]) {
      if (!(key in record)) continue;
      const nested = resolve(record[key], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}
