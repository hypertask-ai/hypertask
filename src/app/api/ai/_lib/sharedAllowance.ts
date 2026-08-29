import { randomUUID } from "node:crypto";
import type { ImageModelMiddleware, LanguageModelMiddleware } from "ai";

import { getRedis } from "@/lib/redis";
import {
  aiAllowancePeriod,
  SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE,
} from "@/lib/aiAllowancePolicy";
import {
  INCLUDED_WITH_HYPERTASK_GATEWAY_TAG,
  SYSTEM_AI_FEATURES,
} from "@/lib/aiUsageClassification";

const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const MICRO_USD_PER_USD = 1_000_000;
const RESERVATION_TTL_MS = 10 * 60 * 1000;
const PRICING_CACHE_MS = 15 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
const RESERVATION_SAFETY_USD = 0.01;
const RESERVATION_SAFETY_MULTIPLIER = 1.5;
const LEGACY_RECONCILIATION_WINDOW_MS = 15 * 60 * 1000;
const LEGACY_RECONCILIATION_INTERVAL_SECONDS = 60;
export const SYSTEM_AI_ALLOWANCE_MULTIPLIER = 10;

type AllowanceLane = "visible" | "system";

export class SharedAiAllowanceExceededError extends Error {
  /**
   * The allowance period this reservation was rejected against. Callers that
   * deduplicate per period must use this rather than re-deriving it from a
   * clock of their own: a caller straddling UTC month rollover would otherwise
   * key its bookkeeping to a different month than the one that actually said no.
   */
  readonly periodKey: string;

  constructor(periodKey: string) {
    super(SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE);
    this.name = "SharedAiAllowanceExceededError";
    this.periodKey = periodKey;
  }
}

export function sharedAiAllowanceErrorMessage(error: unknown): string | null {
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (
    let depth = 0;
    depth < 8 && current && !visited.has(current);
    depth += 1
  ) {
    visited.add(current);
    if (current instanceof Error) {
      if (current.name === "SharedAiAllowanceExceededError") {
        return current.message;
      }
      const wrapped = current as Error & {
        cause?: unknown;
        lastError?: unknown;
      };
      current = wrapped.cause ?? wrapped.lastError;
      continue;
    }
    if (typeof current === "object") {
      const wrapped = current as { cause?: unknown; lastError?: unknown };
      current = wrapped.cause ?? wrapped.lastError;
      continue;
    }
    break;
  }
  return null;
}

type ModelPricing = {
  inputUsdPerToken: number;
  outputUsdPerToken: number;
};

type AllowanceReservation = {
  amountMicroUsd: number;
  committedKey: string;
  id: string;
  pricing: ModelPricing;
  reservationsKey: string;
  ttlSeconds: number;
};

type GatewayUsage = {
  inputTokens: { total?: number };
  outputTokens: { total?: number };
};

let pricingCache:
  { expiresAt: number; models: Map<string, ModelPricing> } | undefined;
let pricingPromise: Promise<Map<string, ModelPricing>> | undefined;

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : null;
};

function usdToMicroUsd(value: number): number {
  return Math.max(0, Math.ceil(value * MICRO_USD_PER_USD));
}

function teamTagFromProviderOptions(providerOptions: unknown): string | null {
  if (!providerOptions || typeof providerOptions !== "object") return null;
  const gateway = (providerOptions as { gateway?: unknown }).gateway;
  if (!gateway || typeof gateway !== "object") return null;
  const tags = (gateway as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return null;

  const teamIds = tags.flatMap((tag) => {
    if (typeof tag !== "string") return [];
    const match = /^team:(.+)$/.exec(tag.trim());
    return match?.[1] ? [match[1]] : [];
  });
  return teamIds.length === 1 ? teamIds[0] : null;
}

function allowanceLaneFromProviderOptions(
  providerOptions: unknown,
): AllowanceLane {
  if (!providerOptions || typeof providerOptions !== "object") return "visible";
  const gateway = (providerOptions as { gateway?: unknown }).gateway;
  if (!gateway || typeof gateway !== "object") return "visible";
  const tags = (gateway as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return "visible";
  return tags.includes(INCLUDED_WITH_HYPERTASK_GATEWAY_TAG)
    ? "system"
    : "visible";
}

async function loadGatewayPricing(): Promise<Map<string, ModelPricing>> {
  if (pricingCache && pricingCache.expiresAt > Date.now()) {
    return pricingCache.models;
  }
  if (pricingPromise) return pricingPromise;

  pricingPromise = (async () => {
    const response = await fetch(`${GATEWAY_BASE_URL}/models`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`AI Gateway model pricing returned ${response.status}`);
    }
    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload.data)) {
      throw new Error("AI Gateway model pricing response is invalid");
    }

    const models = new Map<string, ModelPricing>();
    for (const value of payload.data) {
      if (!value || typeof value !== "object") continue;
      const row = value as { id?: unknown; pricing?: unknown };
      if (
        typeof row.id !== "string" ||
        !row.pricing ||
        typeof row.pricing !== "object"
      ) {
        continue;
      }
      const pricing = row.pricing as { input?: unknown; output?: unknown };
      const inputUsdPerToken = finiteNonNegative(pricing.input);
      const outputUsdPerToken = finiteNonNegative(pricing.output);
      if (inputUsdPerToken === null || outputUsdPerToken === null) continue;
      models.set(row.id, { inputUsdPerToken, outputUsdPerToken });
    }
    pricingCache = { expiresAt: Date.now() + PRICING_CACHE_MS, models };
    return models;
  })();

  try {
    return await pricingPromise;
  } finally {
    pricingPromise = undefined;
  }
}

async function modelPricing(modelSlug: string): Promise<ModelPricing> {
  const pricing = (await loadGatewayPricing()).get(modelSlug);
  if (!pricing) {
    throw new Error(`AI Gateway pricing is unavailable for ${modelSlug}`);
  }
  return pricing;
}

function estimatePromptTokenUpperBound(prompt: unknown): number {
  // UTF-8 bytes are a conservative upper bound for tokenizer pieces and also
  // make inline base64/file inputs reserve meaningful headroom.
  return Buffer.byteLength(JSON.stringify(prompt ?? ""), "utf8");
}

export function estimateReservationMicroUsd(args: {
  maxOutputTokens?: number;
  pricing: ModelPricing;
  prompt: unknown;
}): number {
  const inputTokens = estimatePromptTokenUpperBound(args.prompt);
  const outputTokens = Math.max(
    1,
    Math.ceil(args.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
  );
  const estimatedUsd =
    inputTokens * args.pricing.inputUsdPerToken +
    outputTokens * args.pricing.outputUsdPerToken;
  return usdToMicroUsd(
    estimatedUsd * RESERVATION_SAFETY_MULTIPLIER + RESERVATION_SAFETY_USD,
  );
}

function settledUsageMicroUsd(
  usage: GatewayUsage | undefined,
  pricing: ModelPricing,
  reservedMicroUsd: number,
): number {
  const inputTokens = usage?.inputTokens.total;
  const outputTokens = usage?.outputTokens.total;
  if (
    typeof inputTokens !== "number" ||
    !Number.isFinite(inputTokens) ||
    typeof outputTokens !== "number" ||
    !Number.isFinite(outputTokens)
  ) {
    return reservedMicroUsd;
  }
  const actualUsd =
    Math.max(inputTokens, 0) * pricing.inputUsdPerToken +
    Math.max(outputTokens, 0) * pricing.outputUsdPerToken;
  return usdToMicroUsd(actualUsd);
}

type GatewaySpendBreakdown = {
  legacySystemMicroUsd: number;
  systemMicroUsd: number;
  totalMicroUsd: number;
  visibleMicroUsd: number;
};

async function gatewaySpendBreakdownMicroUsd(
  gatewayApiKey: string,
  teamId: string,
  startDate: string,
  endDate: string,
): Promise<GatewaySpendBreakdown> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    group_by: "tag",
    tags: `team:${teamId}`,
  });
  const response = await fetch(`${GATEWAY_BASE_URL}/report?${params}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${gatewayApiKey}` },
  });
  if (!response.ok) {
    throw new Error(`AI Gateway allowance report returned ${response.status}`);
  }
  const payload = (await response.json()) as { results?: unknown };
  if (!Array.isArray(payload.results)) {
    throw new Error("AI Gateway allowance report is invalid");
  }
  let teamUsd = 0;
  let markedSystemUsd = 0;
  let legacySystemUsd = 0;
  let foundTeamTag = false;

  for (const value of payload.results) {
    if (!value || typeof value !== "object") {
      throw new Error("AI Gateway allowance report row is invalid");
    }
    const row = value as { tag?: unknown; total_cost?: unknown };
    if (typeof row.tag !== "string") {
      throw new Error("AI Gateway allowance report tag is invalid");
    }
    const cost = finiteNonNegative(row.total_cost);
    if (cost === null) throw new Error("AI Gateway allowance cost is invalid");
    const tag = row.tag.trim();
    if (tag === `team:${teamId}`) {
      foundTeamTag = true;
      teamUsd += cost;
    }
    if (tag === INCLUDED_WITH_HYPERTASK_GATEWAY_TAG) {
      markedSystemUsd += cost;
    }
    if ((SYSTEM_AI_FEATURES as readonly string[]).includes(tag)) {
      legacySystemUsd += cost;
    }
  }

  if (payload.results.length > 0 && !foundTeamTag) {
    throw new Error("AI Gateway allowance report omitted the owning team tag");
  }

  // New system calls carry both their feature tag and the stable included tag.
  // max() preserves pre-migration summary/question spend without double-counting
  // new calls that appear in both rows.
  const systemUsd = Math.min(
    teamUsd,
    Math.max(markedSystemUsd, legacySystemUsd),
  );
  return {
    legacySystemMicroUsd: usdToMicroUsd(
      Math.min(teamUsd, Math.max(legacySystemUsd - markedSystemUsd, 0)),
    ),
    systemMicroUsd: usdToMicroUsd(systemUsd),
    totalMicroUsd: usdToMicroUsd(teamUsd),
    visibleMicroUsd: usdToMicroUsd(Math.max(teamUsd - systemUsd, 0)),
  };
}

const INITIALIZE_SPLIT_SCRIPT = `
local initialized = redis.call("SET", KEYS[3], ARGV[5], "EX", ARGV[6], "NX")
if not initialized then return 0 end
local legacyCommitted = tonumber(redis.call("GET", KEYS[1]) or "0")
local observedTotal = tonumber(ARGV[1])
local unreportedLegacy = math.max(legacyCommitted - observedTotal, 0)
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[6])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[6])
redis.call("SET", KEYS[4], unreportedLegacy, "EX", ARGV[6])
redis.call("SET", KEYS[5], ARGV[4], "EX", ARGV[6])
return 1
`;

const RECONCILE_LEGACY_SCRIPT = `
local previousSystem = tonumber(redis.call("GET", KEYS[4]) or "0")
local currentSystem = tonumber(ARGV[1])
local systemDelta = math.max(currentSystem - previousSystem, 0)
local pending = tonumber(redis.call("GET", KEYS[3]) or "0")
local fromPending = math.min(pending, systemDelta)
pending = pending - fromPending
local remaining = systemDelta - fromPending
local visible = tonumber(redis.call("GET", KEYS[1]) or "0")
local fromVisible = math.min(visible, remaining)
redis.call("SET", KEYS[1], visible - fromVisible, "EX", ARGV[2])
redis.call("INCRBY", KEYS[2], fromPending + fromVisible)
redis.call("EXPIRE", KEYS[2], ARGV[2])
redis.call("SET", KEYS[3], pending, "EX", ARGV[2])
redis.call("SET", KEYS[4], currentSystem, "EX", ARGV[2])
if ARGV[3] == "1" then redis.call("SET", KEYS[5], "1", "EX", ARGV[2]) end
return fromPending + fromVisible
`;

const RESERVE_SCRIPT = `
local committed = tonumber(redis.call("GET", KEYS[1]) or "0")
local expired = redis.call("ZRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
for _, member in ipairs(expired) do
  local amount = string.match(member, "|(%d+)$")
  if amount then committed = committed + tonumber(amount) end
end
if #expired > 0 then
  redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
  redis.call("SET", KEYS[1], committed)
end
local active = redis.call("ZRANGE", KEYS[2], 0, -1)
local reserved = 0
for _, member in ipairs(active) do
  local amount = string.match(member, "|(%d+)$")
  if amount then reserved = reserved + tonumber(amount) end
end
local requested = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])
local pending = ARGV[7] == "1" and tonumber(redis.call("GET", KEYS[3]) or "0") or 0
if committed + reserved + pending + requested > cap then return 0 end
redis.call("ZADD", KEYS[2], ARGV[4], ARGV[5])
redis.call("EXPIRE", KEYS[1], ARGV[6])
redis.call("EXPIRE", KEYS[2], ARGV[6])
return 1
`;

const SETTLE_SCRIPT = `
local removed = redis.call("ZREM", KEYS[2], ARGV[1])
if removed == 0 then return 0 end
redis.call("INCRBY", KEYS[1], ARGV[2])
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1
`;

async function reconcileLegacySplit(args: {
  completedKey: string;
  gatewayApiKey: string;
  initializedKey: string;
  legacySystemObservedKey: string;
  lockKey: string;
  month: ReturnType<typeof aiAllowancePeriod>;
  pendingKey: string;
  redis: Awaited<ReturnType<typeof getRedis>>;
  systemCommittedKey: string;
  teamId: string;
  visibleCommittedKey: string;
}) {
  if ((await args.redis.exists(args.completedKey)) === 1) return;
  const initializedAt = Number(await args.redis.get(args.initializedKey));
  if (!Number.isFinite(initializedAt)) return;
  const ageMs = Date.now() - initializedAt;
  if (ageMs < LEGACY_RECONCILIATION_INTERVAL_SECONDS * 1000) return;

  const finalReconciliation = ageMs >= LEGACY_RECONCILIATION_WINDOW_MS;
  const acquired = await args.redis.set(
    args.lockKey,
    "1",
    "EX",
    LEGACY_RECONCILIATION_INTERVAL_SECONDS,
    "NX",
  );
  if (!acquired) return;

  try {
    const observedSpend = await gatewaySpendBreakdownMicroUsd(
      args.gatewayApiKey,
      args.teamId,
      args.month.startDate,
      args.month.endDate,
    );
    await args.redis.eval(
      RECONCILE_LEGACY_SCRIPT,
      5,
      args.visibleCommittedKey,
      args.systemCommittedKey,
      args.pendingKey,
      args.legacySystemObservedKey,
      args.completedKey,
      String(observedSpend.legacySystemMicroUsd),
      String(args.month.ttlSeconds),
      finalReconciliation ? "1" : "0",
    );
  } catch {
    // Pending legacy spend remains conservatively charged to the visible lane.
    // A later request retries after the short reconciliation lock expires.
  }
}

async function reserveSharedAllowance(args: {
  allowanceUsd: number;
  gatewayApiKey: string;
  lane: AllowanceLane;
  maxOutputTokens?: number;
  modelSlug: string;
  prompt: unknown;
  teamId: string;
}): Promise<AllowanceReservation> {
  const now = new Date();
  const month = aiAllowancePeriod(now);
  const keyPrefix = `ai-allowance:${month.key}:${args.teamId}`;
  // The visible lane deliberately keeps the original key names. Rolling
  // deployments therefore share committed spend and active reservations with
  // the previous code instead of opening a fresh cap window.
  const visibleCommittedKey = `${keyPrefix}:committed`;
  const visibleReservationsKey = `${keyPrefix}:reservations`;
  const systemCommittedKey = `${keyPrefix}:system:committed`;
  const systemReservationsKey = `${keyPrefix}:system:reservations`;
  const splitInitializedKey = `${keyPrefix}:system-split-v1`;
  const legacyPendingKey = `${keyPrefix}:legacy-pending`;
  const legacySystemObservedKey = `${keyPrefix}:legacy-system-observed`;
  const legacyReconcileLockKey = `${keyPrefix}:legacy-reconcile-lock`;
  const legacyReconcileCompleteKey = `${keyPrefix}:legacy-reconcile-complete`;
  const committedKey =
    args.lane === "system" ? systemCommittedKey : visibleCommittedKey;
  const reservationsKey =
    args.lane === "system" ? systemReservationsKey : visibleReservationsKey;
  const redis = await getRedis();

  let initialized = false;
  if ((await redis.exists(splitInitializedKey)) === 0) {
    const observedSpend = await gatewaySpendBreakdownMicroUsd(
      args.gatewayApiKey,
      args.teamId,
      month.startDate,
      month.endDate,
    );
    // Atomically split the legacy total ledger once. Active legacy
    // reservations stay in the visible lane, and committed spend not yet
    // present in the Gateway report is retained conservatively.
    initialized =
      Number(
        await redis.eval(
          INITIALIZE_SPLIT_SCRIPT,
          5,
          visibleCommittedKey,
          systemCommittedKey,
          splitInitializedKey,
          legacyPendingKey,
          legacySystemObservedKey,
          String(observedSpend.totalMicroUsd),
          String(observedSpend.visibleMicroUsd),
          String(observedSpend.systemMicroUsd),
          String(observedSpend.legacySystemMicroUsd),
          String(Date.now()),
          String(month.ttlSeconds),
        ),
      ) === 1;
  }

  if (!initialized) {
    await reconcileLegacySplit({
      completedKey: legacyReconcileCompleteKey,
      gatewayApiKey: args.gatewayApiKey,
      initializedKey: splitInitializedKey,
      legacySystemObservedKey,
      lockKey: legacyReconcileLockKey,
      month,
      pendingKey: legacyPendingKey,
      redis,
      systemCommittedKey,
      teamId: args.teamId,
      visibleCommittedKey,
    });
  }

  const pricing = await modelPricing(args.modelSlug);
  const amountMicroUsd = estimateReservationMicroUsd({
    maxOutputTokens: args.maxOutputTokens,
    pricing,
    prompt: args.prompt,
  });
  const id = randomUUID();
  const member = `${id}|${amountMicroUsd}`;
  const expiresAt = Date.now() + RESERVATION_TTL_MS;
  const accepted = await redis.eval(
    RESERVE_SCRIPT,
    3,
    committedKey,
    reservationsKey,
    legacyPendingKey,
    String(Date.now()),
    String(amountMicroUsd),
    String(
      usdToMicroUsd(
        args.allowanceUsd *
          (args.lane === "system" ? SYSTEM_AI_ALLOWANCE_MULTIPLIER : 1),
      ),
    ),
    String(expiresAt),
    member,
    String(month.ttlSeconds),
    args.lane === "visible" ? "1" : "0",
  );
  if (Number(accepted) !== 1) {
    throw new SharedAiAllowanceExceededError(month.key);
  }

  return {
    amountMicroUsd,
    committedKey,
    id: member,
    pricing,
    reservationsKey,
    ttlSeconds: month.ttlSeconds,
  };
}

async function settleReservation(
  reservation: AllowanceReservation,
  usage?: GatewayUsage,
) {
  const settledMicroUsd = settledUsageMicroUsd(
    usage,
    reservation.pricing,
    reservation.amountMicroUsd,
  );
  const redis = await getRedis();
  await redis.eval(
    SETTLE_SCRIPT,
    2,
    reservation.committedKey,
    reservation.reservationsKey,
    reservation.id,
    String(settledMicroUsd),
    String(reservation.ttlSeconds),
  );
}

async function settleAfterInference(
  reservation: AllowanceReservation,
  usage?: GatewayUsage,
) {
  try {
    await settleReservation(reservation, usage);
  } catch {
    // Inference has already started, so the provider may have billed even when
    // it did not return usage. Retry with the conservative reservation amount.
    // If Redis is still unavailable, leave the reservation in place: the next
    // allowance check will convert it to committed spend after expiry.
    try {
      await settleReservation(reservation);
    } catch {
      // The existing reservation continues to count against the team cap.
    }
  }
}

export function createSharedAllowanceMiddleware(args: {
  allowanceUsd: number;
  gatewayApiKey: string;
  modelSlug: string;
}): LanguageModelMiddleware {
  const beforeCall = async (params: {
    maxOutputTokens?: number;
    prompt: unknown;
    providerOptions?: unknown;
  }) => {
    const teamId = teamTagFromProviderOptions(params.providerOptions);
    if (!teamId) {
      throw new Error(
        "Shared AI allowance requests require exactly one owning team tag.",
      );
    }
    return reserveSharedAllowance({
      allowanceUsd: args.allowanceUsd,
      gatewayApiKey: args.gatewayApiKey,
      lane: allowanceLaneFromProviderOptions(params.providerOptions),
      maxOutputTokens: params.maxOutputTokens,
      modelSlug: args.modelSlug,
      prompt: params.prompt,
      teamId,
    });
  };

  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => ({
      ...params,
      // The reservation uses this same bound, so the provider cannot generate
      // more billable output than the amount admitted by the team cap.
      maxOutputTokens: Math.min(
        params.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        DEFAULT_MAX_OUTPUT_TOKENS,
      ),
    }),
    wrapGenerate: async ({ doGenerate, params }) => {
      const reservation = await beforeCall(params);
      try {
        const result = await doGenerate();
        await settleAfterInference(reservation, result.usage);
        return result;
      } catch (error) {
        await settleAfterInference(reservation);
        throw error;
      }
    },
    wrapStream: async ({ doStream, params }) => {
      const reservation = await beforeCall(params);
      try {
        const result = await doStream();
        let settled = false;
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              async transform(chunk, controller) {
                if (chunk.type === "finish") {
                  settled = true;
                  await settleAfterInference(reservation, chunk.usage);
                }
                controller.enqueue(chunk);
              },
              async flush() {
                if (!settled) await settleAfterInference(reservation);
              },
            }),
          ),
        };
      } catch (error) {
        await settleAfterInference(reservation);
        throw error;
      }
    },
  };
}

export function createImageAllowanceMiddleware(args: {
  allowanceUsd: number;
  gatewayApiKey: string;
  modelSlug: string;
}): ImageModelMiddleware {
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      const teamId = teamTagFromProviderOptions(params.providerOptions);
      if (!teamId) {
        throw new Error(
          "Platform-funded image requests require exactly one owning team tag.",
        );
      }
      const reservation = await reserveSharedAllowance({
        allowanceUsd: args.allowanceUsd,
        gatewayApiKey: args.gatewayApiKey,
        lane: allowanceLaneFromProviderOptions(params.providerOptions),
        maxOutputTokens:
          DEFAULT_MAX_OUTPUT_TOKENS * Math.max(1, Math.ceil(params.n)),
        modelSlug: args.modelSlug,
        prompt: params.prompt,
        teamId,
      });
      try {
        const result = await doGenerate();
        await settleAfterInference(
          reservation,
          result.usage
            ? {
                inputTokens: { total: result.usage.inputTokens ?? undefined },
                outputTokens: { total: result.usage.outputTokens ?? undefined },
              }
            : undefined,
        );
        return result;
      } catch (error) {
        await settleAfterInference(reservation);
        throw error;
      }
    },
  };
}
