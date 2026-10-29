import prisma from "@/lib/prisma";
import { reportError } from "@/lib/errors/reportError";

export async function checkDailyAiSpend() {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  let recordedUsd = 0;
  for (const start of [new Date(today.getTime() - 86_400_000), today]) {
    const day = start.toISOString().slice(0, 10);
    const usage = await prisma.aiUsage.aggregate({
      where: {
        createdAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) },
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
      message: `Recorded AI usage estimate exceeded $5 on ${day}: $${spentUsd.toFixed(2)}. Based on saved token usage, not provider invoices.`,
      extra: { route: "/api/cron/ai-spend", stage: "daily-spend", spentUsd },
    });
    if (start === today) recordedUsd = spentUsd;
  }
  return { recordedUsd };
}
