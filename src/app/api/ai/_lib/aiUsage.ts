import prisma from "@/lib/prisma";

export async function logAiUsage(row: {
  userId: number;
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
}): Promise<void> {
  try {
    await prisma.aiUsage.create({ data: row });
  } catch (error) {
    console.error("[aiUsage] failed to log AI usage", error);
  }
}
