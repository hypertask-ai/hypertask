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
  const checkKey = "ai-gateway-credits:v1:hourly-check";
  if (!await redis.set(checkKey, "pending", "EX", 3600, "NX")) {
    if (await redis.get(checkKey) !== "ok") throw new Error("AI Gateway credit observation unavailable");
    return;
  }
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
  const previousKey = "ai-gateway-credits:v1:previous";
  const previous = await redis.get(previousKey);
  await redis.set(baselineKey, previous ?? JSON.stringify(credits), "EX", 172800, "NX");
  const baseline = creditsSchema.parse(JSON.parse(await redis.get(baselineKey) ?? "null"));
  await redis.set(previousKey, JSON.stringify(credits), "EX", 172800);
  const spent = Number(credits.total_used) - Number(baseline.total_used);
  if (spent > 5) await reportError({
    source: "server",
    minimumOccurrences: 1,
    fingerprintKey: `ai-gateway-daily-spend:${day}`,
    message: `AI spending exceeded $5 across today's monitoring window. Observed $${spent.toFixed(2)}; includes the midnight crossing interval.`,
    extra: { route: "/api/cron/ai-allowance-drift", stage: "daily-spend", balanceUsd: Number(credits.balance), spentUsd: spent },
  });
  await redis.set(checkKey, "ok", "EX", 3600);
}
