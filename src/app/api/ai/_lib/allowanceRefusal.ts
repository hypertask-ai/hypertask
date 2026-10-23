import { findSharedAiAllowanceError } from "@/app/api/ai/_lib/allowanceError";

export function warnIfAllowanceRefused(error: unknown, route: string): string | null {
  const message = findSharedAiAllowanceError(error)?.message ?? null;
  if (message) console.warn(`[${route}] refused: included AI allowance used up`);
  return message;
}
