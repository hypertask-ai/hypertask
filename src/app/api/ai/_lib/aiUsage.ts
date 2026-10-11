import prisma from "@/lib/prisma";
import { reportError } from "@/lib/errors/reportError";

export type AiUsageRecord = {
  userId: number | null;
  teamId?: string | null;
  projectId?: number | null;
  taskId?: number | null;
  agentId?: string | null;
  provider: string;
  model: string;
  feature: string;
  inputTokens?: number;
  outputTokens?: number;
  /** HTPR-7076: prompt tokens served from the provider cache (part of inputTokens). */
  cachedInputTokens?: number | null;
  /** HTPR-7076: prompt tokens written to the provider cache (part of inputTokens). */
  cacheWriteInputTokens?: number | null;
  totalTokens?: number;
  costUsd?: number | null;
  latencyMs?: number;
  promptId?: string;
  promptVersion?: string;
  outcome?: string;
  traceId?: string;
};

const SAFE_META_KEYS = ["modelName", "table", "column", "target", "constraint", "field_name"] as const;
const SAFE_NAME = /^[A-Za-z0-9_."\- ]{1,80}$/;

/**
 * HTPR-7101: why a usage row failed to save, without any row values. Only the
 * Prisma code, error class and schema names (table, column, constraint) are kept.
 */
export function describeUsagePersistenceError(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!error || typeof error !== "object") return out;
  const { name, code, meta } = error as { name?: unknown; code?: unknown; meta?: unknown };
  if (typeof name === "string" && SAFE_NAME.test(name)) out.errorName = name;
  if (typeof code === "string" && SAFE_NAME.test(code)) out.prismaCode = code;
  if (meta && typeof meta === "object") {
    for (const key of SAFE_META_KEYS) {
      const value = (meta as Record<string, unknown>)[key];
      const names = (Array.isArray(value) ? value : [value]).filter(
        (item): item is string => typeof item === "string" && SAFE_NAME.test(item),
      );
      if (names.length) out[`meta_${key}`] = names.join(",").slice(0, 200);
    }
  }
  return out;
}

export async function logAiUsage(row: AiUsageRecord): Promise<void> {
  try {
    await prisma.aiUsage.create({ data: row });
  } catch (error) {
    await reportError({
      message: "AI usage persistence failed",
      source: "server",
      fingerprintKey: "ai-usage-persistence",
      extra: { route: "modelProvider", stage: "usage-persistence", ...describeUsagePersistenceError(error) },
    }).catch(() => undefined);
  }
}
