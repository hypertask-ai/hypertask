import { z } from "zod";
import { getRedis } from "@/lib/redis";
import { reportError } from "@/lib/errors/reportError";

const amount = z.string().trim().min(1).refine(value => Number.isFinite(Number(value)));
const creditsSchema = z.object({
  balance: amount,
  total_used: amount.refine(value => Number(value) >= 0),
});

export async function checkDailyGatewaySpend() {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing AI Gateway credit-check credential");
  const redis = await getRedis();
  if (!await redis.set("ai-gateway-credits:v1:hourly-check", "1", "EX", 3600, "NX")) return;
  const response = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("AI Gateway credit metadata unavailable");
  const credits = creditsSchema.parse(await response.json());
  console.info(JSON.stringify({ event: "ai-gateway-credit-observation", at: new Date().toISOString(),
    balanceUsd: Number(credits.balance), totalUsedUsd: Number(credits.total_used),
    totalGrantedUsd: Number(credits.balance) + Number(credits.total_used) }));
  const day = new Date().toISOString().slice(0, 10);
  const baselineKey = `ai-gateway-credits:v1:baseline:${day}`;
  await redis.set(baselineKey, JSON.stringify(credits), "EX", 172800, "NX");
  const baseline = creditsSchema.parse(JSON.parse(await redis.get(baselineKey) ?? "null"));
  const spent = Number(credits.total_used) - Number(baseline.total_used);
  if (spent <= 5) return;
  await reportError({
    source: "server",
    minimumOccurrences: 1,
    fingerprintKey: `ai-gateway-daily-spend:${day}`,
    message: `AI credits spent today exceeded $5. Observed $${spent.toFixed(2)} since the first daily check.`,
    extra: { route: "/api/cron/ai-allowance-drift", stage: "daily-spend", balanceUsd: Number(credits.balance), spentUsd: spent },
  });
}
