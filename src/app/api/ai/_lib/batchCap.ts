import { MICRO_USD_PER_USD } from "@/app/api/ai/_lib/billedAllowance";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { resolveTeamAllowancePolicy } from "@/app/api/ai/_lib/planAllowancePolicy";
import {
  estimateReservationMicroUsd,
  modelPricing,
  reservePlanAllowance,
  settlePlanAllowance,
  type PlanAllowanceReservation,
} from "@/app/api/ai/_lib/sharedAllowance";
import { getRedis } from "@/lib/redis";

const holdKey = (gatewayBatchId: string) => `ai-batch-hold:${gatewayBatchId}`;
export async function reserveBatchWithinTeamCap(args: {
  teamId: string;
  userId: number;
  gatewayKey: string;
  model: string;
  requests: Array<{ prompt: string; maxOutputTokens: number }>;
}) {
  const funding = await getTeamGatewayFunding({ trustedTeamId: args.teamId }, { includeProvenance: true });
  if (!funding || funding.source === "customer" || funding.apiKey !== args.gatewayKey) {
    throw new Error("Batch dispatch requires a capped team gateway key");
  }
  const policy = await resolveTeamAllowancePolicy(args.teamId, funding.source);
  const pricing = await modelPricing(args.model);
  const amountMicroUsd = args.requests.reduce((sum, request) => sum + estimateReservationMicroUsd({ pricing, prompt: request.prompt, maxOutputTokens: request.maxOutputTokens }), 0);
  return reservePlanAllowance({
    teamId: args.teamId,
    policy,
    gatewayApiKey: funding.apiKey,
    fundingSource: funding.source,
    amountUsd: amountMicroUsd / MICRO_USD_PER_USD,
    amountMicroUsd,
    userId: args.userId,
  });
}
export function bindBatchHold(gatewayBatchId: string, reservation: PlanAllowanceReservation) {
  return getRedis().then((redis) => redis.set(holdKey(gatewayBatchId), JSON.stringify(reservation), "EX", 60 * 60 * 24 * 45));
}
export function releaseUnboundBatchHold(reservation: PlanAllowanceReservation) {
  return settlePlanAllowance(reservation, 0);
}
export async function settleBatchHold(gatewayBatchId: string, actualUsd: number) {
  const redis = await getRedis();
  const raw = await redis.get(holdKey(gatewayBatchId));
  if (!raw) return;
  await settlePlanAllowance(JSON.parse(raw) as PlanAllowanceReservation, actualUsd);
  await redis.del(holdKey(gatewayBatchId));
}
