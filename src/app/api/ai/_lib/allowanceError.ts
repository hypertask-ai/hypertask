export const SHARED_AI_ALLOWANCE_ERROR_NAME = "SharedAiAllowanceExceededError";

export function findSharedAiAllowanceError(error: unknown): (Error & { periodKey?: string }) | null {
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error && current.name === SHARED_AI_ALLOWANCE_ERROR_NAME) {
      return current as Error & { periodKey?: string };
    }
    if (typeof current !== "object") break;
    const wrapped = current as { cause?: unknown; lastError?: unknown };
    current = wrapped.cause ?? wrapped.lastError;
  }
  return null;
}
