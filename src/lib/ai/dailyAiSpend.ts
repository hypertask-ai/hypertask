import prisma from "@/lib/prisma";
import { reportError } from "@/lib/errors/reportError";

export async function checkDailyAiSpend() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const usage = await prisma.aiUsage.aggregate({
    where: {
      createdAt: { gte: start, lt: end },
      provider: { not: { startsWith: "byok:" } },
      costUsd: { gte: 0 },
    },
    _sum: { costUsd: true },
  });
  const spentUsd = usage._sum.costUsd ?? 0;
  if (!Number.isFinite(spentUsd) || spentUsd < 0) throw new Error("Invalid recorded AI usage cost");
  if (spentUsd > 5) await reportError({
    source: "server",
    minimumOccurrences: 1,
    fingerprintKey: `ai-gateway-daily-spend:${day}`,
    message: `Recorded AI usage estimate exceeded $5 today: $${spentUsd.toFixed(2)}. Based on saved token usage, not provider invoices.`,
    extra: { route: "/api/cron/ai-spend", stage: "daily-spend", spentUsd },
  });
  return { recordedUsd: spentUsd };
}
