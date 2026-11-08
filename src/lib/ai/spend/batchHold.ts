import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { resolveTeamAllowancePolicy } from "@/app/api/ai/_lib/planAllowancePolicy";
import {
  modelCostUsd,
  modelPricing,
  reservePlanAllowance,
  settlePlanAllowance,
  type PlanAllowanceReservation,
} from "@/app/api/ai/_lib/sharedAllowance";
import type { BatchItemOutcome, BatchTextRequest } from "@/lib/ai/batch/batchJobs";
import {
  batchHoldMicroUsd,
  halfPriceMicroUsd,
  monthEndHoldUntilMs,
  upperBoundTokens,
} from "@/lib/ai/spend/remainingSpend";
import { aiAllowancePeriod } from "@/lib/aiAllowancePolicy";
import { getRedis } from "@/lib/redis";

const INTENT_PREFIX = "ai-batch-hold:v1:";
const GATEWAY_PREFIX = "ai-batch-gateway:v1:";

type Intent = {
  status: "held" | "settled";
  reservation: PlanAllowanceReservation;
  estimateMicroUsd: number;
};

function intentKey(idempotencyKey: string) {
  return `${INTENT_PREFIX}${idempotencyKey}`;
}

function gatewayKey(gatewayBatchId: string) {
  return `${GATEWAY_PREFIX}${gatewayBatchId}`;
}

async function readIntent(idempotencyKey: string): Promise<Intent | null> {
  const raw = await (await getRedis()).get(intentKey(idempotencyKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Intent;
    if (!parsed?.reservation?.id || (parsed.status !== "held" && parsed.status !== "settled")) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeIntent(idempotencyKey: string, intent: Intent) {
  await (await getRedis()).set(intentKey(idempotencyKey), JSON.stringify(intent), "EX", aiAllowancePeriod().ttlSeconds);
}

export async function holdPlanBatch(args: {
  idempotencyKey: string;
  teamId: string;
  userId: number;
  gatewayKey: string;
  model: string;
  requests: BatchTextRequest[];
}): Promise<void> {
  const existing = await readIntent(args.idempotencyKey);
  if (existing) return;
  const funding = await getTeamGatewayFunding({ trustedTeamId: args.teamId });
  if (!funding || funding.source === "customer" || funding.apiKey !== args.gatewayKey) return;
  const policy = await resolveTeamAllowancePolicy(args.teamId, funding.source);
  if (policy.mode !== "plan") return;

  const redis = await getRedis();
  const key = intentKey(args.idempotencyKey);
  const owned = await redis.set(key, JSON.stringify({ status: "reserving" }), "EX", 60, "NX");
  if (!owned) {
    const again = await readIntent(args.idempotencyKey);
    if (again) return;
    throw new Error("Batch spend hold is already in progress");
  }

  let reservation: PlanAllowanceReservation | null = null;
  try {
    const pricing = await modelPricing(args.model);
    const estimateMicroUsd = batchHoldMicroUsd(args.requests.map((request) => ({
      inputTokens: upperBoundTokens(`${request.instructions}\n${request.prompt}`),
      outputTokens: request.maxOutputTokens,
      inputUsdPerToken: pricing.inputUsdPerToken,
      outputUsdPerToken: pricing.outputUsdPerToken,
    })));
    reservation = await reservePlanAllowance({
      teamId: args.teamId,
      policy,
      gatewayApiKey: funding.apiKey,
      fundingSource: funding.source,
      amountUsd: estimateMicroUsd / 1_000_000,
      amountMicroUsd: estimateMicroUsd,
      lane: "visible",
      userId: args.userId,
      reservationId: args.idempotencyKey,
      holdUntilMs: monthEndHoldUntilMs(new Date()),
    });
    await writeIntent(args.idempotencyKey, { status: "held", reservation, estimateMicroUsd });
  } catch (error) {
    if (reservation) await settlePlanAllowance(reservation, 0, "error").catch(() => undefined);
    await redis.del(key);
    throw error;
  }
}

export async function rememberBatchGateway(idempotencyKey: string, gatewayBatchId: string): Promise<void> {
  if (!(await readIntent(idempotencyKey))) return;
  await (await getRedis()).set(gatewayKey(gatewayBatchId), idempotencyKey, "EX", aiAllowancePeriod().ttlSeconds);
}

export async function releasePlanBatch(idempotencyKey: string): Promise<void> {
  const intent = await readIntent(idempotencyKey);
  if (!intent || intent.status !== "held") {
    await (await getRedis()).del(intentKey(idempotencyKey));
    return;
  }
  await settlePlanAllowance(intent.reservation, 0, "error");
  await (await getRedis()).del(intentKey(idempotencyKey));
}

export async function settleHeldBatch(args: {
  gatewayBatchId: string;
  model: string;
  outcomes: BatchItemOutcome[];
}): Promise<void> {
  const redis = await getRedis();
  const idempotencyKey = await redis.get(gatewayKey(args.gatewayBatchId));
  if (!idempotencyKey) return;
  const intent = await readIntent(idempotencyKey);
  if (!intent || intent.status !== "held") return;
  const pricing = await modelPricing(args.model);
  let normalUsd = 0;
  for (const outcome of args.outcomes) {
    if (outcome.status !== "succeeded") continue;
    normalUsd += modelCostUsd(
      pricing,
      outcome.usage.inputTokens,
      outcome.usage.outputTokens,
      outcome.usage.cachedInputTokens ?? 0,
      outcome.usage.cacheWriteInputTokens ?? 0,
    );
  }
  await settlePlanAllowance(intent.reservation, halfPriceMicroUsd(normalUsd) / 1_000_000, "finish");
  await writeIntent(idempotencyKey, { ...intent, status: "settled" });
}
