import { randomUUID } from "node:crypto";
import { findSharedAiAllowanceError, SHARED_AI_ALLOWANCE_ERROR_NAME } from "@/app/api/ai/_lib/allowanceError";
import type { ImageModelMiddleware, LanguageModelMiddleware } from "ai";

import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7079_FAILED_AI_ALLOWANCE_FLAG } from "@/lib/flags/definitions/htpr-7079-failed-ai-allowance";
import { HTPR_7687_ALLOWANCE_RESYNC_FLAG } from "@/lib/flags/definitions/htpr-7687-allowance-resync";
import { isHaiku55Model } from "@/lib/aiModelOptions";
import { previousModelForFailedStream } from "@/app/api/ai/chat/stream/modelFallback";
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
const GATEWAY_RESYNC_INTERVAL_SECONDS = 60;
const GATEWAY_REPORT_DELAY_WINDOW_MS = 15 * 60 * 1000;
export const SYSTEM_AI_ALLOWANCE_MULTIPLIER = 10;

type AllowanceLane = "visible" | "system";

export async function teamAllowanceSnapshot(
  teamId: string,
  allowanceUsd: number,
): Promise<{ allowanceUsd: number; usedUsd: number } | null> {
  try {
    const redis = await getRedis();
    const committed = await redis.get(
      `ai-allowance:${aiAllowancePeriod().key}:${teamId}:committed`,
    );
    return { allowanceUsd, usedUsd: Number(committed ?? 0) / MICRO_USD_PER_USD };
  } catch {
    return null;
  }
}

export class SharedAiAllowanceExceededError extends Error {
  readonly periodKey: string;

  constructor(periodKey: string) {
    super(SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE);
    this.name = SHARED_AI_ALLOWANCE_ERROR_NAME;
    this.periodKey = periodKey;
  }
}

export function sharedAiAllowanceErrorMessage(error: unknown): string | null {
  return findSharedAiAllowanceError(error)?.message ?? null;
}

type ModelPricing = {
  inputUsdPerToken: number;
  outputUsdPerToken: number;
  longRequest?: {
    tokenThreshold: number;
    inputUsdPerToken: number;
    outputUsdPerToken: number;
  };
};

export const CACHE_READ_INPUT_MULTIPLIER = 0.1;
export const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;

export function modelCostUsd(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const input = Math.max(inputTokens, 0);
  const output = Math.max(outputTokens, 0);
  const cacheRead = Math.min(Math.max(cacheReadTokens || 0, 0), input);
  const cacheWrite = Math.min(Math.max(cacheWriteTokens || 0, 0), input - cacheRead);
  const rates = pricing.longRequest && input + output > pricing.longRequest.tokenThreshold
    ? pricing.longRequest
    : pricing;
  const plainInput = input - cacheRead - cacheWrite;
  return (
    (plainInput +
      cacheRead * CACHE_READ_INPUT_MULTIPLIER +
      cacheWrite * CACHE_WRITE_INPUT_MULTIPLIER) *
      rates.inputUsdPerToken +
    output * rates.outputUsdPerToken
  );
}

type AllowanceReservation = {
  amountMicroUsd: number;
  committedKey: string;
  id: string;
  inputOnlyMicroUsd: number | null;
  pricing: ModelPricing;
  recentSettledKey: string | null;
  reservationsKey: string;
  ttlSeconds: number;
};

type GatewayUsage = {
  inputTokens: { total?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens: { total?: number };
};

let pricingCache:
  { expiresAt: number; models: Map<string, ModelPricing> } | undefined;
let pricingPromise: Promise<Map<string, ModelPricing>> | undefined;

export function resetGatewayPricingCacheForTests() {
  pricingCache = undefined;
  pricingPromise = undefined;
}

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

export function gatewayCatalogModelSlug(modelSlug: string): string {
  if (isHaiku55Model(modelSlug)) return "anthropic/claude-haiku-5.5";
  return modelSlug.startsWith("xai/")
    ? `spacexai/${modelSlug.slice("xai/".length)}`
    : modelSlug;
}

function gatewayPricingLookupSlugs(modelSlug: string): string[] {
  const catalogSlug = gatewayCatalogModelSlug(modelSlug);
  const slugs = [catalogSlug];
  if (modelSlug !== catalogSlug) slugs.push(modelSlug);
  if (modelSlug.startsWith("spacexai/")) {
    slugs.push(`xai/${modelSlug.slice("spacexai/".length)}`);
  }
  return slugs;
}

export async function modelPricing(modelSlug: string): Promise<ModelPricing> {
  if (isHaiku55Model(modelSlug)) {
    return {
      inputUsdPerToken: 0.10 / 1_000_000,
      outputUsdPerToken: 0.50 / 1_000_000,
      longRequest: {
        tokenThreshold: 100_000,
        inputUsdPerToken: 0.50 / 1_000_000,
        outputUsdPerToken: 2.50 / 1_000_000,
      },
    };
  }
  const models = await loadGatewayPricing();
  for (const slug of gatewayPricingLookupSlugs(modelSlug)) {
    const pricing = models.get(slug);
    if (pricing) return pricing;
  }
  const tier = /^openai\/gpt-6(?:\.\d+)?-(luna|sol)$/.exec(modelSlug)?.[1]
    ?? (/^anthropic\/claude-opus-5[.-]5$/.test(modelSlug) ? "opus" : null);
  if (tier) {
    const floor = tier === "luna"
      ? { inputUsdPerToken: 0.00001, outputUsdPerToken: 0.00004 }
      : tier === "sol"
        ? { inputUsdPerToken: 0.00002, outputUsdPerToken: 0.00008 }
        : { inputUsdPerToken: 0.00003, outputUsdPerToken: 0.00012 };
    const sameTier = tier === "opus"
      ? /^anthropic\/claude-opus-/
      : new RegExp(`^openai/gpt-[\\d.]+-${tier}$`);
    for (const [slug, price] of models) {
      if (!sameTier.test(slug)) continue;
      floor.inputUsdPerToken = Math.max(floor.inputUsdPerToken, price.inputUsdPerToken);
      floor.outputUsdPerToken = Math.max(floor.outputUsdPerToken, price.outputUsdPerToken);
    }
    return floor;
  }
  throw new Error(`AI Gateway pricing is unavailable for ${modelSlug}`);
}

function estimatePromptTokenUpperBound(prompt: unknown): number {
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
  const estimatedUsd = modelCostUsd(args.pricing, inputTokens, outputTokens);
  return usdToMicroUsd(
    estimatedUsd * RESERVATION_SAFETY_MULTIPLIER + RESERVATION_SAFETY_USD,
  );
}

function inputOnlyMicroUsd(pricing: ModelPricing, prompt: unknown): number {
  return usdToMicroUsd(
    modelCostUsd(pricing, estimatePromptTokenUpperBound(prompt), 0),
  );
}

async function failedCallsCountInputOnly(): Promise<boolean> {
  try {
    return await isFeatureEnabled(HTPR_7079_FAILED_AI_ALLOWANCE_FLAG, 0);
  } catch {
    return false;
  }
}

async function allowanceFollowsRealSpend(): Promise<boolean> {
  try {
    return await isFeatureEnabled(HTPR_7687_ALLOWANCE_RESYNC_FLAG, 0);
  } catch {
    return false;
  }
}

function settledUsageMicroUsd(
  usage: GatewayUsage | undefined,
  pricing: ModelPricing,
  reservedMicroUsd: number,
  inputOnlyBeforeOutputMicroUsd: number | null = null,
): number {
  const inputTokens = usage?.inputTokens.total;
  const outputTokens = usage?.outputTokens.total;
  if (
    typeof inputTokens !== "number" ||
    !Number.isFinite(inputTokens) ||
    typeof outputTokens !== "number" ||
    !Number.isFinite(outputTokens)
  ) {
    return inputOnlyBeforeOutputMicroUsd === null
      ? reservedMicroUsd
      : Math.min(inputOnlyBeforeOutputMicroUsd, reservedMicroUsd);
  }
  const actualUsd = modelCostUsd(
    pricing,
    inputTokens,
    outputTokens,
    usage?.inputTokens.cacheRead,
    usage?.inputTokens.cacheWrite,
  );
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
  if KEYS[4] then redis.call("ZADD", KEYS[4], ARGV[1], member) end
end
if #expired > 0 then
  redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
  redis.call("SET", KEYS[1], committed)
  if KEYS[4] then redis.call("EXPIRE", KEYS[4], ARGV[6]) end
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

const SETTLE_AND_REMEMBER_SCRIPT = `
local removed = redis.call("ZREM", KEYS[2], ARGV[1])
if removed == 0 then return 0 end
redis.call("INCRBY", KEYS[1], ARGV[2])
redis.call("EXPIRE", KEYS[1], ARGV[3])
redis.call("ZADD", KEYS[3], ARGV[4], ARGV[1] .. "|" .. ARGV[2])
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", ARGV[5])
redis.call("EXPIRE", KEYS[3], ARGV[3])
redis.call("SET", KEYS[4], ARGV[4], "EX", ARGV[3], "NX")
return 1
`;

const RESYNC_TO_GATEWAY_SCRIPT = `
redis.call("SET", KEYS[3], ARGV[5], "EX", ARGV[4], "NX")
local journalCoversDelay = tonumber(redis.call("GET", KEYS[3])) <= tonumber(ARGV[3])
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[2])
local recentlySettled = 0
for _, member in ipairs(redis.call("ZRANGE", KEYS[2], 0, -1)) do
  local amount = string.match(member, "|(%d+)$")
  if amount then recentlySettled = recentlySettled + tonumber(amount) end
end
local committed = tonumber(redis.call("GET", KEYS[1]) or "0")
local observed = tonumber(ARGV[1])
local resynced = math.max(observed, committed)
if journalCoversDelay then
  resynced = math.max(observed, math.min(committed, observed + recentlySettled))
end
redis.call("SET", KEYS[1], resynced, "EX", ARGV[4])
return committed - resynced
`;

async function resyncToGatewaySpend(args: {
  committedKey: string;
  gatewayApiKey: string;
  journalStartedKey: string;
  lane: AllowanceLane;
  lockKey: string;
  month: ReturnType<typeof aiAllowancePeriod>;
  recentSettledKey: string;
  redis: Awaited<ReturnType<typeof getRedis>>;
  teamId: string;
}): Promise<boolean> {
  const acquired = await args.redis.set(
    args.lockKey,
    "1",
    "EX",
    GATEWAY_RESYNC_INTERVAL_SECONDS,
    "NX",
  );
  if (!acquired) return false;
  let observedSpend: GatewaySpendBreakdown;
  try {
    observedSpend = await gatewaySpendBreakdownMicroUsd(
      args.gatewayApiKey,
      args.teamId,
      args.month.startDate,
      args.month.endDate,
    );
  } catch {
    return false;
  }
  const now = Date.now();
  await args.redis.eval(
    RESYNC_TO_GATEWAY_SCRIPT,
    3,
    args.committedKey,
    args.recentSettledKey,
    args.journalStartedKey,
    String(
      args.lane === "system"
        ? observedSpend.systemMicroUsd
        : observedSpend.visibleMicroUsd,
    ),
    String(now - GATEWAY_REPORT_DELAY_WINDOW_MS),
    String(now - GATEWAY_REPORT_DELAY_WINDOW_MS - RESERVATION_TTL_MS),
    String(args.month.ttlSeconds),
    String(now),
  );
  return true;
}

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
  const lanePrefix = args.lane === "system" ? `${keyPrefix}:system` : keyPrefix;
  const followsRealSpend = await allowanceFollowsRealSpend();
  const redis = await getRedis();

  let initialized = false;
  if ((await redis.exists(splitInitializedKey)) === 0) {
    const observedSpend = await gatewaySpendBreakdownMicroUsd(
      args.gatewayApiKey,
      args.teamId,
      month.startDate,
      month.endDate,
    );
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
  const inputOnly = (await failedCallsCountInputOnly())
    ? inputOnlyMicroUsd(pricing, args.prompt)
    : null;
  const id = randomUUID();
  const member = `${id}|${amountMicroUsd}`;
  const expiresAt = Date.now() + RESERVATION_TTL_MS;
  const recentSettledKey = `${lanePrefix}:recent-settled`;
  const journalStartedKey = `${recentSettledKey}-since`;
  if (!followsRealSpend) await redis.del(journalStartedKey);
  const reserve = () => redis.eval(
    RESERVE_SCRIPT,
    followsRealSpend ? 4 : 3,
    committedKey,
    reservationsKey,
    legacyPendingKey,
    ...(followsRealSpend ? [recentSettledKey] : []),
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
  let accepted = Number(await reserve()) === 1;
  if (
    !accepted &&
    followsRealSpend &&
    (await resyncToGatewaySpend({
      committedKey,
      gatewayApiKey: args.gatewayApiKey,
      journalStartedKey,
      lane: args.lane,
      lockKey: `${lanePrefix}:gateway-resync-lock`,
      month,
      recentSettledKey,
      redis,
      teamId: args.teamId,
    }))
  ) {
    accepted = Number(await reserve()) === 1;
  }
  if (!accepted) {
    throw new SharedAiAllowanceExceededError(month.key);
  }

  return {
    amountMicroUsd,
    committedKey,
    id: member,
    inputOnlyMicroUsd: inputOnly,
    pricing,
    recentSettledKey: followsRealSpend ? recentSettledKey : null,
    reservationsKey,
    ttlSeconds: month.ttlSeconds,
  };
}

async function commitReservation(
  reservation: AllowanceReservation,
  settledMicroUsd: number,
) {
  const redis = await getRedis();
  if (reservation.recentSettledKey) {
    const now = Date.now();
    await redis.eval(
      SETTLE_AND_REMEMBER_SCRIPT,
      4,
      reservation.committedKey,
      reservation.reservationsKey,
      reservation.recentSettledKey,
      `${reservation.recentSettledKey}-since`,
      reservation.id,
      String(settledMicroUsd),
      String(reservation.ttlSeconds),
      String(now),
      String(now - GATEWAY_REPORT_DELAY_WINDOW_MS),
    );
    return;
  }
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

async function settleReservation(
  reservation: AllowanceReservation,
  usage?: GatewayUsage,
  beforeOutput = false,
) {
  await commitReservation(
    reservation,
    settledUsageMicroUsd(
      usage,
      reservation.pricing,
      reservation.amountMicroUsd,
      beforeOutput ? reservation.inputOnlyMicroUsd : null,
    ),
  );
}

async function releaseUnavailableReservation(reservation: AllowanceReservation) {
  await commitReservation(reservation, 0);
}

async function settleAfterInference(
  reservation: AllowanceReservation,
  usage?: GatewayUsage,
  beforeOutput = false,
) {
  try {
    await settleReservation(reservation, usage, beforeOutput);
  } catch {
    try {
      await settleReservation(reservation);
    } catch {
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
        if (previousModelForFailedStream(args.modelSlug.split("/").at(-1)!, error, false, false, isHaiku55Model(args.modelSlug))) {
          await releaseUnavailableReservation(reservation);
        } else {
          await settleAfterInference(reservation, undefined, true);
        }
        throw error;
      }
    },
    wrapStream: async ({ doStream, params }) => {
      const reservation = await beforeCall(params);
      const releaseIfUnavailable = async (error: unknown, hasOutput: boolean) => {
        if (previousModelForFailedStream(args.modelSlug.split("/").at(-1)!, error, hasOutput, false, isHaiku55Model(args.modelSlug))) {
          await releaseUnavailableReservation(reservation);
        } else {
          await settleAfterInference(reservation, undefined, !hasOutput);
        }
      };
      try {
        const result = await doStream();
        const reader = result.stream.getReader();
        let settled = false;
        let hasOutput = false;
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              try {
                const item = await reader.read();
                if (item.done) {
                  if (!settled) {
                    settled = true;
                    await settleAfterInference(reservation, undefined, !hasOutput);
                  }
                  controller.close();
                  return;
                }
                const chunk = item.value;
                if (chunk.type === "finish") {
                  settled = true;
                  await settleAfterInference(reservation, chunk.usage);
                } else if (chunk.type === "error" && !settled) {
                  settled = true;
                  await releaseIfUnavailable(chunk.error, hasOutput);
                } else if (chunk.type !== "stream-start" && chunk.type !== "response-metadata") {
                  hasOutput = true;
                }
                controller.enqueue(chunk);
              } catch (error) {
                if (!settled) {
                  settled = true;
                  await releaseIfUnavailable(error, hasOutput);
                }
                controller.error(error);
              }
            },
            async cancel(reason) {
              try {
                await reader.cancel(reason);
              } finally {
                if (!settled) {
                  settled = true;
                  await settleAfterInference(reservation, undefined, !hasOutput);
                }
              }
            },
          }),
        };
      } catch (error) {
        await releaseIfUnavailable(error, false);
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
