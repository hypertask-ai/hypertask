import { AsyncLocalStorage } from "node:async_hooks";
import { getRedis } from "@/lib/redis";

const backgroundReports = new AsyncLocalStorage<boolean>();

export function withBackgroundReportBudget<T>(work: () => Promise<T>): Promise<T> {
  return backgroundReports.run(true, work);
}

export async function gatewayReport(apiKey: string, params: URLSearchParams, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  if (backgroundReports.getStore()) {
    const redis = await getRedis();
    if (!await redis.set("ai-gateway-report:v1:hourly-budget", "1", "EX", 3600, "NX")) {
      throw new Error("AI Gateway paid report hourly budget exhausted");
    }
  }
  return fetch(`https://ai-gateway.vercel.sh/v1/report?${params}`, {
    signal,
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}
