import { getRedis } from "@/lib/redis";

export async function gatewayReport(apiKey: string, params: URLSearchParams, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  const redis = await getRedis();
  if (!await redis.set("ai-gateway-report:v1:hourly-budget", "1", "EX", 3600, "NX")) {
    throw new Error("AI Gateway paid report hourly budget exhausted");
  }
  return fetch(`https://ai-gateway.vercel.sh/v1/report?${params}`, {
    signal,
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}
