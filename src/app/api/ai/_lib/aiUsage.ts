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
  totalTokens?: number;
  costUsd?: number | null;
  latencyMs?: number;
  promptId?: string;
  promptVersion?: string;
  outcome?: string;
  traceId?: string;
};

export async function logAiUsage(row: AiUsageRecord): Promise<void> {
  try {
    await prisma.aiUsage.create({ data: row });
  } catch {
    await reportError({
      message: "AI usage persistence failed",
      source: "server",
      fingerprintKey: "ai-usage-persistence",
      extra: { route: "modelProvider", stage: "usage-persistence" },
    }).catch(() => undefined);
  }
}
