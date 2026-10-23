export function toErrorMessage(payload: unknown, fallback: string): string {
  const resolved = resolve(payload, 0);
  return resolved ?? fallback;
}

function resolve(payload: unknown, depth: number): string | null {
  if (depth > 4) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed && trimmed !== "[object Object]" ? trimmed : null;
  }
  if (payload instanceof Error) {
    const message = payload.message.trim();
    return message && message !== "[object Object]" ? message : null;
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
