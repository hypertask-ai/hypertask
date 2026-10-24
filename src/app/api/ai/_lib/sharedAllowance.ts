import { randomUUID } from "node:crypto";
import { findSharedAiAllowanceError, SHARED_AI_ALLOWANCE_ERROR_NAME } from "@/app/api/ai/_lib/allowanceError";
import type { ImageModelMiddleware, LanguageModelMiddleware } from "ai";

import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7079_FAILED_AI_ALLOWANCE_FLAG } from "@/lib/flags/definitions/htpr-7079-failed-ai-allowance";
import { HTPR_7692_ALLOWANCE_DRIFT_CHECK_FLAG } from "@/lib/flags/definitions/htpr-7692-allowance-drift-check";
import { HTPR_7687_ALLOWANCE_RESYNC_FLAG } from "@/lib/flags/definitions/htpr-7687-allowance-resync";
import { isHaiku55Model } from "@/lib/aiModelOptions";
import { previousModelForFailedStream } from "@/app/api/ai/chat/stream/modelFallback";
import {
  aiAllowancePeriod,
  SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE,
  DAILY_AI_ALLOWANCE_EXCEEDED_MESSAGE,
  DEMO_GLOBAL_AI_ALLOWANCE_USD,
  type TeamAllowancePolicy,
} from "@/lib/aiAllowancePolicy";
import { INCLUDED_WITH_HYPERTASK_GATEWAY_TAG } from "@/lib/aiUsageClassification";

import {
  BILLED_ALLOWANCE_SCOPE_INDEX,
  EXPIRE_RESERVATION_SCRIPT,
  GATEWAY_BASE_URL,
  GATEWAY_REPORT_DELAY_WINDOW_MS,
  MICRO_USD_PER_USD,
  RESERVATION_TTL_MS,
  billedAllowancePeriod,
  billedCostEnabled,
  demoGatewaySpendMicroUsd,
  effectiveAccountingSource,
  finiteNonNegative,
  gatewaySpendBreakdownMicroUsd,
  logBilledRelease,
  reserveBilledScopes,
  resolveBilledFunding,
  seedAllowanceScope,
  usdToMicroUsd,
  type BilledCall,
  type EffectiveAccountingSource,
  type HoldReleaseReason,
} from "./billedAllowance";

export { BILLED_ALLOWANCE_SCOPE_INDEX, billedAllowancePeriod, billedCostEnabled, effectiveAccountingSource,
  gatewaySpendBreakdownMicroUsd, resolveBilledFunding };
export type { BilledFunding, EffectiveAccountingSource } from "./billedAllowance";

const PRICING_CACHE_MS = 15 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
const MIN_DAILY_OUTPUT_TOKENS = 256;
const RESERVATION_SAFETY_USD = 0.01;
const RESERVATION_SAFETY_MULTIPLIER = 1.5;
const LEGACY_RECONCILIATION_WINDOW_MS = 15 * 60 * 1000;
const LEGACY_RECONCILIATION_INTERVAL_SECONDS = 60;
const GATEWAY_RESYNC_INTERVAL_SECONDS = 60;
export const SYSTEM_AI_ALLOWANCE_MULTIPLIER = 10;

type AllowanceLane = "visible" | "system";

export type AllowanceDriftContext = {
  mode: "legacy" | "plan";
  monthlyUsd: number;
  fundingSource: "managed" | "shared" | "demo" | "unknown";
  fundingChanged?: boolean;
};

export type AllowanceRefusal = {
  id: string;
  time: number;
  teamId: string | null;
  reason: "month" | "day" | "demo";
  lane: AllowanceLane;
  cap: number;
  committed: number;
  liveHolds: number;
  requestedHold: number;
  policyMode: "legacy" | "plan";
  fundingSource: AllowanceDriftContext["fundingSource"];
};

export type AllowanceRefusalBucket = {
  count: number;
  event: AllowanceRefusal;
  committed: number;
  time: number;
};

export function allowanceDriftTtl(now = new Date(), periodKey = aiAllowancePeriod(now).key) {
  const [year, month] = periodKey.split("-").map(Number);
  return Math.max(60, Math.ceil((Date.UTC(year, month, 8) - now.getTime()) / 1000));
}

async function observeAllowanceAttempt(args: {
  teamId?: string;
  fundingSource?: AllowanceDriftContext["fundingSource"];
  policy: { mode: "legacy" | "plan"; monthlyUsd: number; demoGlobal?: boolean };
}): Promise<boolean> {
  try {
    if (!await isFeatureEnabled(HTPR_7692_ALLOWANCE_DRIFT_CHECK_FLAG, 0)) return false;
    if (!args.teamId) return Boolean(args.policy.demoGlobal);
    const redis = await getRedis();
    const month = aiAllowancePeriod().key;
    const context: AllowanceDriftContext = {
      mode: args.policy.mode, monthlyUsd: args.policy.monthlyUsd,
      fundingSource: args.fundingSource ?? "unknown",
    };
    await redis.eval(`
redis.call("SADD", KEYS[1], ARGV[1])
redis.call("EXPIRE", KEYS[1], ARGV[3])
local context = cjson.decode(ARGV[2])
local previous = redis.call("GET", KEYS[2])
if previous then
  local saved = cjson.decode(previous)
  if saved.fundingChanged or saved.fundingSource ~= context.fundingSource then context.fundingChanged = true end
end
redis.call("SET", KEYS[2], cjson.encode(context), "EX", ARGV[3])
return 1
`, 2, `ai-allowance-drift:${month}:active`, `ai-allowance-drift:${month}:${args.teamId}:context`,
      args.teamId, JSON.stringify(context), String(allowanceDriftTtl()));
    return true;
  } catch {
    return false;
  }
}

async function recordAllowanceRefusal(event: Omit<AllowanceRefusal, "id" | "time">, month: string) {
  try {
    const redis = await getRedis();
    const value: AllowanceRefusal = { ...event, id: randomUUID(), time: Date.now() };
    const prefix = `ai-allowance-drift:${month}:${event.teamId ?? "teamless:demo"}`;
    const bucket = [Math.floor(value.time / 300_000), event.reason, event.policyMode, event.lane, event.fundingSource, event.cap].join(":");
    await redis.eval(`
if ARGV[1] ~= "" then
  redis.call("SADD", KEYS[1], ARGV[1])
  redis.call("SADD", KEYS[4], ARGV[1])
end
redis.call("EXPIRE", KEYS[1], ARGV[3])
redis.call("EXPIRE", KEYS[4], ARGV[3])
local event = cjson.decode(ARGV[2])
local saved = redis.call("HGET", KEYS[3], ARGV[4])
local bucket = saved and cjson.decode(saved) or {count = 0, event = event}
bucket.count = bucket.count + 1
local headroomUsed = event.committed + event.liveHolds + event.requestedHold
local previous = bucket.event
local previousUsed = previous.committed + previous.liveHolds + previous.requestedHold
if headroomUsed < previousUsed or (headroomUsed == previousUsed and event.time < previous.time) then bucket.event = event end
if not bucket.time or event.time >= bucket.time then
  bucket.committed = event.committed
  bucket.time = event.time
end
redis.call("HSET", KEYS[3], ARGV[4], cjson.encode(bucket))
redis.call("EXPIRE", KEYS[3], ARGV[3])
redis.call("ZADD", KEYS[2], event.time, ARGV[2])
if redis.call("ZCARD", KEYS[2]) > 500 then redis.call("ZPOPMAX", KEYS[2]) end
redis.call("EXPIRE", KEYS[2], ARGV[3])
return 1
`, 4, `ai-allowance-drift:${month}:active`, `${prefix}:refusal-events`, `${prefix}:refusal-buckets`, `ai-allowance-drift:${month}:refusal-active`,
      event.teamId ?? "", JSON.stringify(value), String(allowanceDriftTtl(new Date(), month)), bucket);
  } catch {}
}

export async function teamAllowanceSnapshot(
  teamId: string,
  allowanceUsd: number,
  policy?: TeamAllowancePolicy,
  context?: { userId: number; gatewayApiKey?: string; fundingSource?: AllowanceDriftContext["fundingSource"]; billed?: boolean },
): Promise<{ allowanceUsd: number; usedUsd: number } | null> {
  try {
    const redis = await getRedis();
    const billed = context?.billed ?? await billedCostEnabled(context?.userId ?? null);
    if (billed) {
      const source = await effectiveAccountingSource({ teamId, kind: "month", period: aiAllowancePeriod().key,
        funding: await resolveBilledFunding({ teamId, ...context }) });
      if (source.mode === "billed") return { allowanceUsd: policy?.mode === "plan" ? policy.monthlyUsd : allowanceUsd,
        usedUsd: (policy?.mode === "plan" ? source.total! : source.visible!) / MICRO_USD_PER_USD };
      if (!context?.gatewayApiKey) return null;
      await initializeTeamMonth({ teamId, gatewayApiKey: context.gatewayApiKey });
      if (policy?.mode !== "plan") {
        const prefix = `ai-allowance:${aiAllowancePeriod().key}:${teamId}`;
        const total = await redis.eval(`
if redis.call("EXISTS", KEYS[3]) == 0 then return nil end
local visible = redis.call("GET", KEYS[1])
if not visible then return nil end
return tonumber(visible) + tonumber(redis.call("GET", KEYS[2]) or "0")
`, 3, `${prefix}:committed`, `${prefix}:legacy-pending`, `${prefix}:system-split-v1`);
        return total == null ? null : { allowanceUsd, usedUsd: Number(total) / MICRO_USD_PER_USD };
      }
    }
    if (policy?.mode === "plan") {
      const prefix = `ai-allowance:${aiAllowancePeriod().key}:${teamId}`;
      const total = await redis.eval(`
local visible = redis.call("GET", KEYS[1])
local system = redis.call("GET", KEYS[2])
${billed ? `if redis.call("EXISTS", KEYS[4]) == 0 or not visible or not system then return nil end` : ""}
if not visible and not system then return nil end
return tonumber(visible or "0") + tonumber(system or "0") + tonumber(redis.call("GET", KEYS[3]) or "0")
`, billed ? 4 : 3, `${prefix}:committed`, `${prefix}:system:committed`, `${prefix}:legacy-pending`, ...(billed ? [`${prefix}:system-split-v1`] : []));
      return total == null ? null : { allowanceUsd: policy.monthlyUsd, usedUsd: Number(total) / MICRO_USD_PER_USD };
    }
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

  constructor(periodKey: string, readonly reason: "month" | "day" | "demo" = "month") {
    super(reason === "day" ? DAILY_AI_ALLOWANCE_EXCEEDED_MESSAGE : SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE);
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
  recentSettledKey: string;
  reservationsKey: string;
  ttlSeconds: number;
  scopes?: PlanAllowanceReservation;
  billedCall?: BilledCall;
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

function userIdFromProviderOptions(providerOptions: unknown): number | null {
  const tags = (providerOptions as { gateway?: { tags?: unknown } } | null)?.gateway?.tags;
  if (!Array.isArray(tags)) return null;
  const userIds = tags.flatMap((tag) => {
    const match = typeof tag === "string" ? /^user:(\d+)$/.exec(tag.trim()) : null;
    return match ? [Number(match[1])] : [];
  });
  return userIds.length === 1 ? userIds[0] : null;
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

async function allowanceFollowsRealSpend(userId: number | null): Promise<boolean> {
  try {
    return await isFeatureEnabled(HTPR_7687_ALLOWANCE_RESYNC_FLAG, userId ?? 0);
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

export async function gatewayHourlySpend(
  gatewayApiKey: string,
  teamId: string,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<Array<{ hour: number; totalUsd: number }> | null> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    group_by: "day",
    date_part: "hour",
    tags: `team:${teamId}`,
  });
  const response = await fetch(`${GATEWAY_BASE_URL}/report?${params}`, {
    signal,
    cache: "no-store",
    headers: { Authorization: `Bearer ${gatewayApiKey}` },
  });
  if (!response.ok) throw new Error("AI Gateway hourly allowance report failed");
  const payload = await response.json() as { results?: unknown };
  if (!Array.isArray(payload.results)) throw new Error("AI Gateway hourly allowance report is invalid");
  if (payload.results.length === 0) return null;
  const hours = new Map<number, number>();
  for (const value of payload.results) {
    if (!value || typeof value !== "object") throw new Error("AI Gateway hourly allowance row is invalid");
    const row = value as { hour?: unknown; total_cost?: unknown };
    if (typeof row.hour !== "string" || !/[T ]\d{2}:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(row.hour)) return null;
    const hour = Date.parse(row.hour);
    const cost = finiteNonNegative(row.total_cost);
    if (!Number.isFinite(hour) || hour % 3_600_000 !== 0 || cost === null || hours.has(hour) ||
      hour < Date.parse(`${startDate}T00:00:00Z`) || hour >= Date.parse(`${endDate}T00:00:00Z`) + 86_400_000) {
      throw new Error("AI Gateway hourly allowance row is invalid");
    }
    if (cost * MICRO_USD_PER_USD > Number.MAX_SAFE_INTEGER) throw new Error("AI Gateway hourly allowance cost is invalid");
    hours.set(hour, cost);
  }
  return [...hours].map(([hour, totalUsd]) => ({ hour, totalUsd }));
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
${EXPIRE_RESERVATION_SCRIPT}
local expired = redis.call("ZRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
for _, member in ipairs(expired) do
  expireReservation(member, KEYS[1], KEYS[2], ARGV[6], tonumber(ARGV[1]))
end
local committed = tonumber(redis.call("GET", KEYS[1]) or "0")
local active = redis.call("ZRANGE", KEYS[2], 0, -1)
local reserved = 0
for _, member in ipairs(active) do
  local amount = string.match(member, "|(%d+)$")
  if amount then reserved = reserved + tonumber(amount) end
end
local requested = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])
local pending = ARGV[7] == "1" and tonumber(redis.call("GET", KEYS[3]) or "0") or 0
if committed + reserved + pending + requested > cap then
  if #expiredBilled > 0 then return {0, committed + pending, reserved, cjson.encode(expiredBilled)} end
  if ARGV[8] == "1" then return {0, committed + pending, reserved} end
  return 0
end
redis.call("ZADD", KEYS[2], ARGV[4], ARGV[5])
redis.call("EXPIRE", KEYS[1], ARGV[6])
redis.call("EXPIRE", KEYS[2], ARGV[6])
if #expiredBilled > 0 then return {1, committed + pending, reserved, cjson.encode(expiredBilled)} end
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
local legacyPending = KEYS[4] and tonumber(redis.call("GET", KEYS[4]) or "0") or 0
local observed = math.max(tonumber(ARGV[1]) - legacyPending, 0)
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
  legacyPendingKey: string;
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
  const changed = await args.redis.eval(
    RESYNC_TO_GATEWAY_SCRIPT,
    args.lane === "visible" ? 4 : 3,
    args.committedKey,
    args.recentSettledKey,
    args.journalStartedKey,
    ...(args.lane === "visible" ? [args.legacyPendingKey] : []),
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
  return Number(changed) !== 0;
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
  signal?: AbortSignal;
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
      args.signal,
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

async function initializeTeamMonth(args: { teamId: string; gatewayApiKey: string }, now = new Date(), tolerateReportFailure = false) {
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
  const redis = await getRedis();

  let initialized = false;
  try {
    if ((await redis.exists(splitInitializedKey)) === 0) {
      const observedSpend = await gatewaySpendBreakdownMicroUsd(
        args.gatewayApiKey,
        args.teamId,
        month.startDate,
        month.endDate,
        tolerateReportFailure ? AbortSignal.timeout(3_000) : undefined,
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
        signal: tolerateReportFailure ? AbortSignal.timeout(3_000) : undefined,
      });
    }
  } catch (error) {
    if (!tolerateReportFailure) throw error;
  }
  return { redis, month, visibleCommittedKey, visibleReservationsKey, systemCommittedKey, systemReservationsKey, legacyPendingKey };
}

async function boundDailyOutputTokens(args: {
  dailyUsd: number;
  gatewayApiKey: string;
  fundingSource?: AllowanceDriftContext["fundingSource"];
  maxOutputTokens?: number;
  pricing: ModelPricing;
  prompt: unknown;
  teamId: string;
  lane: AllowanceLane;
  observe: boolean;
  billed: boolean;
  call: BilledCall;
}, retry = false): Promise<number> {
  const period = aiAllowancePeriod();
  const source = args.billed ? await effectiveAccountingSource({ teamId: args.teamId, kind: "day", period: period.endDate,
    funding: await resolveBilledFunding(args) }) : null;
  const { month, redis } = await initializeTeamMonth(args, new Date(), source?.mode === "billed");
  const prefix = `ai-allowance:day:${month.endDate}:${args.teamId}`;
  await seedAllowanceScope(prefix, 2 * 86_400, async () => source?.mode === "billed" ? source.total! :
    (await gatewaySpendBreakdownMicroUsd(args.gatewayApiKey, args.teamId, month.endDate, month.endDate, args.billed ? AbortSignal.timeout(3_000) : undefined)).totalMicroUsd, args.billed);
  if (args.billed && aiAllowancePeriod().endDate !== period.endDate) return boundDailyOutputTokens(args);
  const dailySnapshot = await redis.eval(`
${EXPIRE_RESERVATION_SCRIPT}
${args.billed ? `for _, member in ipairs(redis.call("ZRANGEBYSCORE", KEYS[2], "-inf", ${Date.now()})) do
  expireReservation(member, KEYS[1], KEYS[2], ${2 * 86_400}, ${Date.now()})
end` : ""}
local committed = tonumber(redis.call("GET", KEYS[1]) or "0")
local mode = "v1"
${source?.mode === "billed" ? `if redis.call("HGET", KEYS[3], "funding") == ARGV[3] and redis.call("HGET", KEYS[3], "unusable") ~= "1" then
  local billed = redis.call("HGET", KEYS[3], "total")
  if billed then committed = tonumber(billed); mode = "billed" end
end` : ""}
${args.billed ? `if mode == "v1" and redis.call("EXISTS", (string.gsub(KEYS[1], ":committed$", ":seeded"))) == 0 then return "shadow-uninitialized" end` : ""}
local remaining = tonumber(ARGV[1]) - committed
for _, member in ipairs(redis.call("ZRANGE", KEYS[2], 0, -1)) do
  remaining = remaining - reservationHeldAmount(member, KEYS[2])
end
${args.billed ? `return {remaining, committed, tonumber(ARGV[1]) - committed - remaining, mode, #expiredBilled == 0 and "[]" or cjson.encode(expiredBilled)}` : `if ARGV[2] == "1" then return {remaining, committed, tonumber(ARGV[1]) - committed - remaining} end
return remaining`}
`, source?.mode === "billed" ? 3 : 2, `${prefix}:committed`, `${prefix}:reservations`, ...(source?.mode === "billed" ? [source.key] : []),
    String(usdToMicroUsd(args.dailyUsd)), ...(source?.mode === "billed" ? ["1", source.funding!] : args.observe ? ["1"] : []));
  if (dailySnapshot === "shadow-uninitialized") {
    if (retry) throw new Error("AI allowance shadow unavailable");
    return boundDailyOutputTokens(args, true);
  }
  if (args.billed && Array.isArray(dailySnapshot)) {
    for (const call of JSON.parse(String(dailySnapshot[4])) as BilledCall[]) logBilledRelease(call, "expiry");
  }
  if (args.billed && aiAllowancePeriod().endDate !== period.endDate) return boundDailyOutputTokens(args);
  const remaining = Number(Array.isArray(dailySnapshot) ? dailySnapshot[0] : dailySnapshot);
  let upper = Math.max(1, Math.floor(Math.min(args.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS)));
  let lower = Math.min(MIN_DAILY_OUTPUT_TOKENS, upper);
  const estimate = (maxOutputTokens: number) => estimateReservationMicroUsd({ ...args, maxOutputTokens });
  if (estimate(MIN_DAILY_OUTPUT_TOKENS) > remaining) {
    if (args.billed) console.info(JSON.stringify({ event: "ai-allowance-billed-decision", ...args.call,
      decision: "refuse", scope: source!.key, mode: Array.isArray(dailySnapshot) ? dailySnapshot[3] : source!.mode, billed: Number(Array.isArray(dailySnapshot) ? dailySnapshot[1] : 0),
      holds: Number(Array.isArray(dailySnapshot) ? dailySnapshot[2] : 0), requested: estimate(MIN_DAILY_OUTPUT_TOKENS), cap: usdToMicroUsd(args.dailyUsd) }));
    if (args.observe && Array.isArray(dailySnapshot)) await recordAllowanceRefusal({
      teamId: args.teamId, reason: "day", lane: args.lane, cap: usdToMicroUsd(args.dailyUsd),
      committed: Number(dailySnapshot[1]), liveHolds: Number(dailySnapshot[2]),
      requestedHold: estimate(MIN_DAILY_OUTPUT_TOKENS), policyMode: "plan",
      fundingSource: args.fundingSource ?? "unknown",
    }, month.key);
    throw new SharedAiAllowanceExceededError(month.key, "day");
  }
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (estimate(middle) <= remaining) lower = middle;
    else upper = middle - 1;
  }
  return lower;
}

async function reserveSharedAllowance(args: {
  allowanceUsd: number;
  gatewayApiKey: string;
  fundingSource?: AllowanceDriftContext["fundingSource"];
  lane: AllowanceLane;
  languageModelParams?: { maxOutputTokens?: number };
  maxOutputTokens?: number;
  modelSlug: string;
  prompt: unknown;
  teamId: string;
  userId: number | null;
  resolvePolicy?: (teamId: string) => Promise<TeamAllowancePolicy>;
}, retry = false): Promise<AllowanceReservation> {
  const policy = await args.resolvePolicy?.(args.teamId);
  const observe = await observeAllowanceAttempt({ ...args, policy: policy ?? { mode: "legacy", monthlyUsd: args.allowanceUsd } });
  const billed = await billedCostEnabled(args.userId);
  const call: BilledCall = { teamId: args.teamId, userId: args.userId ?? 0, reservationId: randomUUID() };
  const selectedMonth = aiAllowancePeriod();
  const source = billed && policy?.mode !== "plan" ? await effectiveAccountingSource({ teamId: args.teamId, kind: "month",
    period: selectedMonth.key, funding: await resolveBilledFunding(args) }) : null;
  const legacy = policy?.mode === "plan" ? null : await initializeTeamMonth(args, new Date(), source?.mode === "billed");
  const pricing = await modelPricing(args.modelSlug);
  let maxOutputTokens = args.maxOutputTokens;
  if (policy?.mode === "plan" && policy.dailyUsd !== null && args.languageModelParams) {
    maxOutputTokens = await boundDailyOutputTokens({ ...args, dailyUsd: policy.dailyUsd, pricing, observe, billed, call });
    args.languageModelParams.maxOutputTokens = maxOutputTokens;
  }
  const amountMicroUsd = estimateReservationMicroUsd({
    maxOutputTokens,
    pricing,
    prompt: args.prompt,
  });
  const inputOnly = (await failedCallsCountInputOnly())
    ? inputOnlyMicroUsd(pricing, args.prompt)
    : null;
  if (policy?.mode === "plan") {
    const scopes = await reservePlanAllowance({
      teamId: args.teamId, policy, gatewayApiKey: args.gatewayApiKey, fundingSource: args.fundingSource,
      amountUsd: amountMicroUsd / MICRO_USD_PER_USD, amountMicroUsd, lane: args.lane, userId: args.userId, observe, billed, billedCall: billed ? call : undefined,
    });
    const scope = scopes.scopes[0];
    return { amountMicroUsd, committedKey: scope.committedKey, id: scopes.id, inputOnlyMicroUsd: inputOnly, pricing, recentSettledKey: scope.committedKey.replace(/:committed$/, ":recent-settled"), reservationsKey: scope.reservationsKey, ttlSeconds: scope.ttlSeconds, scopes, ...(scopes.billedCall ? { billedCall: scopes.billedCall } : {}) };
  }
  const { redis, month, visibleCommittedKey, visibleReservationsKey, systemCommittedKey, systemReservationsKey, legacyPendingKey } = legacy!;
  const committedKey = args.lane === "system" ? systemCommittedKey : visibleCommittedKey;
  const reservationsKey = args.lane === "system" ? systemReservationsKey : visibleReservationsKey;
  const id = billed ? call.reservationId : randomUUID();
  const member = billed
    ? `${id}|${JSON.stringify([[committedKey, reservationsKey, month.ttlSeconds, amountMicroUsd, call]])}|${amountMicroUsd}`
    : `${id}|${amountMicroUsd}`;
  const expiresAt = Date.now() + RESERVATION_TTL_MS;
  const lanePrefix = committedKey.replace(/:committed$/, "");
  const followsRealSpend = await allowanceFollowsRealSpend(args.userId);
  const recentSettledKey = `${lanePrefix}:recent-settled`;
  const journalStartedKey = `${recentSettledKey}-since`;
  const reserve = async () => {
    const decision = await redis.eval(
      RESERVE_SCRIPT,
      4,
      committedKey,
      reservationsKey,
      legacyPendingKey,
      recentSettledKey,
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
      ...(observe ? ["1"] : []),
    );
    if (Array.isArray(decision) && decision[3]) {
      for (const call of JSON.parse(String(decision[3])) as BilledCall[]) logBilledRelease(call, "expiry");
    }
    return decision;
  };
  if (billed && aiAllowancePeriod().endDate !== selectedMonth.endDate) {
    if (retry) throw new Error("AI allowance period unavailable");
    return reserveSharedAllowance(args, true);
  }
  const billedScopes: AllowanceScope[] = billed ? [{ reason: "month", cap: usdToMicroUsd(args.allowanceUsd * (args.lane === "system" ? SYSTEM_AI_ALLOWANCE_MULTIPLIER : 1)),
    pairs: [{ committedKey, reservationsKey }], pendingKey: args.lane === "visible" ? legacyPendingKey : undefined,
    writeIndex: 1, ttlSeconds: month.ttlSeconds, seedKey: `ai-allowance:${month.key}:${args.teamId}:system-split-v1`, source: source!, field: args.lane, endsAt: billedAllowancePeriod("month", month.key).endsAt, billedTtlSeconds: billedAllowancePeriod("month", month.key).ttlSeconds }] : [];
  const reserveOn = () => reserveBilledScopes({ keys: [committedKey, reservationsKey, legacyPendingKey],
    encoded: billedScopes.map((scope) => ({ ...scope, pairs: [[1, 2]], pending: scope.pendingKey ? 3 : undefined })),
    amount: amountMicroUsd, id: member, call, month: month.key, day: month.endDate });
  let billedDecision = billed ? await reserveOn() : null;
  if (billedDecision?.retry) {
    if (retry) throw new Error(`AI allowance unavailable: ${billedDecision.retry}`);
    return reserveSharedAllowance(args, true);
  }
  let decision = billedDecision?.decision ?? await reserve();
  let accepted = Number(Array.isArray(decision) ? decision[0] : decision) === 1;
  if (
    !accepted &&
    followsRealSpend &&
    (!billed || source?.mode === "v1") &&
    (await resyncToGatewaySpend({
      committedKey,
      gatewayApiKey: args.gatewayApiKey,
      journalStartedKey,
      lane: args.lane,
      legacyPendingKey,
      lockKey: `${lanePrefix}:gateway-resync-lock`,
      month,
      recentSettledKey,
      redis,
      teamId: args.teamId,
    }))
  ) {
    billedDecision = billed ? await reserveOn() : null;
    decision = billedDecision?.decision ?? await reserve();
    accepted = Number(Array.isArray(decision) ? decision[0] : decision) === 1;
  }
  if (billedDecision?.retry) {
    if (retry) throw new Error(`AI allowance unavailable: ${billedDecision.retry}`);
    return reserveSharedAllowance(args, true);
  }
  if (billedDecision) for (const detail of billedDecision.details) console.info(JSON.stringify({
    event: "ai-allowance-billed-decision", ...call, decision: accepted ? "allow" : "refuse", ...detail,
  }));
  if (!accepted) {
    if (observe && Array.isArray(decision)) await recordAllowanceRefusal({
      teamId: args.teamId, reason: "month", lane: args.lane,
      cap: usdToMicroUsd(args.allowanceUsd * (args.lane === "system" ? SYSTEM_AI_ALLOWANCE_MULTIPLIER : 1)),
      committed: Number(decision[1]), liveHolds: Number(decision[2]), requestedHold: amountMicroUsd, policyMode: "legacy",
      fundingSource: args.fundingSource ?? "unknown",
    }, month.key);
    throw new SharedAiAllowanceExceededError(month.key);
  }

  return {
    amountMicroUsd,
    committedKey,
    id: member,
    inputOnlyMicroUsd: inputOnly,
    pricing,
    recentSettledKey,
    reservationsKey,
    ttlSeconds: month.ttlSeconds,
    ...(billed ? { billedCall: call } : {}),
  };
}

async function commitReservation(
  reservation: AllowanceReservation,
  settledMicroUsd: number,
  reason: HoldReleaseReason = "finish",
) {
  if (reservation.scopes) {
    await settlePlanAllowance(reservation.scopes, settledMicroUsd / MICRO_USD_PER_USD, reason);
    return;
  }
  const redis = await getRedis();
  const now = Date.now();
  const removed = await redis.eval(
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
  if (Number(removed) > 0 && reservation.billedCall) logBilledRelease(reservation.billedCall, reason);
}

async function settleReservation(
  reservation: AllowanceReservation,
  usage?: GatewayUsage,
  beforeOutput = false,
  reason: HoldReleaseReason = "finish",
) {
  await commitReservation(
    reservation,
    settledUsageMicroUsd(
      usage,
      reservation.pricing,
      reservation.amountMicroUsd,
      beforeOutput ? reservation.inputOnlyMicroUsd : null,
    ),
    reason,
  );
}

async function releaseUnavailableReservation(reservation: AllowanceReservation) {
  await commitReservation(reservation, 0, "error");
}

async function settleAfterInference(
  reservation: AllowanceReservation,
  usage?: GatewayUsage,
  beforeOutput = false,
  reason: HoldReleaseReason = "finish",
) {
  try {
    await settleReservation(reservation, usage, beforeOutput, reason);
  } catch {
    try {
      await settleReservation(reservation, undefined, false, reason);
    } catch {
    }
  }
}

export function createSharedAllowanceMiddleware(args: {
  allowanceUsd: number;
  gatewayApiKey: string;
  fundingSource?: AllowanceDriftContext["fundingSource"];
  modelSlug: string;
  resolvePolicy?: (teamId: string) => Promise<TeamAllowancePolicy>;
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
      resolvePolicy: args.resolvePolicy,
      gatewayApiKey: args.gatewayApiKey,
      fundingSource: args.fundingSource,
      lane: allowanceLaneFromProviderOptions(params.providerOptions),
      languageModelParams: params,
      maxOutputTokens: params.maxOutputTokens,
      modelSlug: args.modelSlug,
      prompt: params.prompt,
      teamId,
      userId: userIdFromProviderOptions(params.providerOptions),
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
          await settleAfterInference(reservation, undefined, true, "error");
        }
        throw error;
      }
    },
    wrapStream: async ({ doStream, params }) => {
      const reservation = await beforeCall(params);
      let settled = false;
      let hasOutput = false;
      let terminal: Promise<void> | undefined;
      const cleanup = () => params.abortSignal?.removeEventListener("abort", onAbort);
      const release = (reason: HoldReleaseReason, usage?: GatewayUsage, beforeOutput = false) => {
        if (settled) return terminal;
        settled = true;
        cleanup();
        terminal = settleAfterInference(reservation, usage, beforeOutput, reason);
        return terminal;
      };
      const onAbort = () => { void release("stop", undefined, !hasOutput); };
      const releaseIfUnavailable = async (error: unknown, output: boolean) => {
        if (settled) return terminal;
        settled = true;
        cleanup();
        terminal = previousModelForFailedStream(args.modelSlug.split("/").at(-1)!, error, output, false, isHaiku55Model(args.modelSlug))
          ? releaseUnavailableReservation(reservation)
          : settleAfterInference(reservation, undefined, !output, "error");
        return terminal;
      };
      if (reservation.billedCall) {
        params.abortSignal?.addEventListener("abort", onAbort, { once: true });
        if (params.abortSignal?.aborted) onAbort();
      }
      try {
        const result = await doStream();
        const reader = result.stream.getReader();
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              try {
                const item = await reader.read();
                if (item.done) {
                  await release("eof", undefined, !hasOutput);
                  controller.close();
                  return;
                }
                const chunk = item.value;
                if (chunk.type === "finish") {
                  await release("finish", chunk.usage);
                } else if (chunk.type === "error" && !settled) {
                  await releaseIfUnavailable(chunk.error, hasOutput);
                } else if (chunk.type !== "stream-start" && chunk.type !== "response-metadata") {
                  hasOutput = true;
                }
                controller.enqueue(chunk);
              } catch (error) {
                await releaseIfUnavailable(error, hasOutput);
                controller.error(error);
              }
            },
            async cancel(reason) {
              if (reservation.billedCall) await release("stop", undefined, !hasOutput);
              try {
                await reader.cancel(reason);
              } finally {
                await release("stop", undefined, !hasOutput);
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
  fundingSource?: AllowanceDriftContext["fundingSource"];
  modelSlug: string;
  resolvePolicy?: (teamId: string) => Promise<TeamAllowancePolicy>;
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
        resolvePolicy: args.resolvePolicy,
        gatewayApiKey: args.gatewayApiKey,
        fundingSource: args.fundingSource,
        lane: allowanceLaneFromProviderOptions(params.providerOptions),
        maxOutputTokens:
          DEFAULT_MAX_OUTPUT_TOKENS * Math.max(1, Math.ceil(params.n)),
        modelSlug: args.modelSlug,
        prompt: params.prompt,
        teamId,
        userId: userIdFromProviderOptions(params.providerOptions),
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
        await settleAfterInference(reservation, undefined, false, params.abortSignal?.aborted ? "stop" : "error");
        throw error;
      }
    },
  };
}

type AllowanceScope = {
  reason: "month" | "day" | "demo";
  cap: number;
  pairs: Array<{ committedKey: string; reservationsKey: string }>;
  pendingKey?: string;
  writeIndex: number;
  ttlSeconds: number;
  source?: EffectiveAccountingSource;
  seedKey?: string;
  field?: "visible" | "system" | "total";
  endsAt?: number;
  billedTtlSeconds?: number;
};

export type PlanAllowanceReservation = {
  id: string;
  scopes: Array<{ committedKey: string; reservationsKey: string; ttlSeconds: number }>;
  billedCall?: BilledCall;
};

const RESERVE_SCOPES_SCRIPT = `
${EXPIRE_RESERVATION_SCRIPT}
local scopes = cjson.decode(ARGV[1])
local now = tonumber(ARGV[2])
local amount = tonumber(ARGV[3])
for index, scope in ipairs(scopes) do
  local total = 0
  local held = 0
  for _, pair in ipairs(scope.pairs) do
    local expired = redis.call("ZRANGEBYSCORE", KEYS[pair[2]], "-inf", now)
    for _, member in ipairs(expired) do
      expireReservation(member, KEYS[pair[1]], KEYS[pair[2]], scope.ttlSeconds, now)
    end
    total = total + tonumber(redis.call("GET", KEYS[pair[1]]) or "0")
    for _, member in ipairs(redis.call("ZRANGE", KEYS[pair[2]], 0, -1)) do
      held = held + reservationHeldAmount(member, KEYS[pair[2]])
    end
  end
  if scope.pending then total = total + tonumber(redis.call("GET", KEYS[scope.pending]) or "0") end
  if total + held + amount > scope.cap then
    if #expiredBilled > 0 then return {-index, total, held, cjson.encode(expiredBilled)} end
    if ARGV[6] == "1" then return {-index, total, held} end
    return -index
  end
end
for _, scope in ipairs(scopes) do
  local pair = scope.pairs[scope.writeIndex]
  redis.call("ZADD", KEYS[pair[2]], ARGV[4], ARGV[5])
  redis.call("EXPIRE", KEYS[pair[1]], scope.ttlSeconds)
  redis.call("EXPIRE", KEYS[pair[2]], scope.ttlSeconds)
end
if #expiredBilled > 0 then return {1, 0, 0, cjson.encode(expiredBilled)} end
return 1
`;

const SETTLE_SCOPES_SCRIPT = `
local scopes = cjson.decode(ARGV[1])
local removed = 0
for _, scope in ipairs(scopes) do
  if redis.call("ZREM", KEYS[scope[2]], ARGV[2]) == 1 then
    redis.call("INCRBY", KEYS[scope[1]], ARGV[3])
    redis.call("EXPIRE", KEYS[scope[1]], scope[3])
    local lanePrefix = string.match(KEYS[scope[1]], "^(ai%-allowance:%d%d%d%d%-%d%d:.+):committed$")
    if lanePrefix then
      local journalKey = lanePrefix .. ":recent-settled"
      redis.call("ZADD", journalKey, ARGV[4], ARGV[2] .. "|" .. ARGV[3])
      redis.call("ZREMRANGEBYSCORE", journalKey, "-inf", ARGV[5])
      redis.call("EXPIRE", journalKey, scope[3])
      redis.call("SET", journalKey .. "-since", ARGV[4], "EX", scope[3], "NX")
    end
    removed = removed + 1
  end
end
return removed
`;

export async function reservePlanAllowance(args: {
  teamId?: string;
  policy: TeamAllowancePolicy;
  gatewayApiKey: string;
  fundingSource?: AllowanceDriftContext["fundingSource"];
  amountUsd: number;
  amountMicroUsd?: number;
  lane?: AllowanceLane;
  userId?: number | null;
  observe?: boolean;
  billed?: boolean;
  billedCall?: BilledCall;
}, retry = false): Promise<PlanAllowanceReservation> {
  if (args.policy.mode !== "plan" || !Number.isFinite(args.amountUsd) || args.amountUsd < 0 ||
    (args.amountMicroUsd !== undefined && (!Number.isSafeInteger(args.amountMicroUsd) || args.amountMicroUsd < 0))) {
    throw new Error("Plan AI allowance reservation requires a plan policy and a valid amount");
  }
  if (!args.teamId && !args.policy.demoGlobal) throw new Error("AI allowance reservation requires an owning team or demo scope");
  const fundingSource = args.fundingSource ?? (!args.teamId && args.policy.demoGlobal ? "demo" : "unknown");
  const observe = args.observe ?? await observeAllowanceAttempt({ ...args, fundingSource });
  const billed = args.billed ?? await billedCostEnabled(args.userId ?? null);
  const now = new Date();
  const month = aiAllowancePeriod(now);
  const scopes: AllowanceScope[] = [];
  const funding = billed && args.teamId ? await resolveBilledFunding(args) : null;
  const monthSource = billed && args.teamId ? await effectiveAccountingSource({ teamId: args.teamId, kind: "month", period: month.key, funding }) : null;
  const daySource = billed && args.teamId && args.policy.dailyUsd !== null ? await effectiveAccountingSource({ teamId: args.teamId, kind: "day", period: month.endDate, funding }) : null;
  const demoSource = billed && args.policy.demoGlobal ? await effectiveAccountingSource({ teamId: "demo", kind: "month", period: month.key,
    funding: await resolveBilledFunding({ fundingSource: "demo" }) }) : null;
  const pair = (prefix: string) => ({ committedKey: `${prefix}:committed`, reservationsKey: `${prefix}:reservations` });
  if (args.teamId) {
    const initialized = await initializeTeamMonth({ teamId: args.teamId, gatewayApiKey: args.gatewayApiKey }, now, monthSource?.mode === "billed");
    scopes.push({ reason: "month", cap: usdToMicroUsd(args.policy.monthlyUsd),
      pairs: [pair(`ai-allowance:${month.key}:${args.teamId}`), pair(`ai-allowance:${month.key}:${args.teamId}:system`)],
      pendingKey: initialized.legacyPendingKey, writeIndex: args.lane === "system" ? 2 : 1, ttlSeconds: month.ttlSeconds });
    if (args.policy.dailyUsd !== null) {
      const prefix = `ai-allowance:day:${month.endDate}:${args.teamId}`;
      await seedAllowanceScope(prefix, 2 * 86_400, async () => daySource?.mode === "billed" ? daySource.total! :
        (await gatewaySpendBreakdownMicroUsd(args.gatewayApiKey, args.teamId!, month.endDate, month.endDate, billed ? AbortSignal.timeout(3_000) : undefined)).totalMicroUsd, billed);
      scopes.push({ reason: "day", cap: usdToMicroUsd(args.policy.dailyUsd), pairs: [pair(prefix)], writeIndex: 1, ttlSeconds: 2 * 86_400 });
    }
  }
  if (args.policy.demoGlobal) {
    const prefix = `ai-allowance:demo:${month.key}`;
    const demoKey = process.env.DEMO_AI_GATEWAY_API_KEY?.trim();
    if (demoKey) await seedAllowanceScope(prefix, month.ttlSeconds, async () => demoSource?.mode === "billed" ? demoSource.total! :
      demoGatewaySpendMicroUsd(demoKey, month, billed ? AbortSignal.timeout(3_000) : undefined), billed);
    scopes.push({ reason: "demo", cap: usdToMicroUsd(DEMO_GLOBAL_AI_ALLOWANCE_USD), pairs: [pair(prefix)], writeIndex: 1, ttlSeconds: month.ttlSeconds });
  }
  if (billed) {
    for (const scope of scopes) {
      const kind = scope.reason === "day" ? "day" : "month";
      const period = kind === "day" ? month.endDate : month.key;
      scope.source = (scope.reason === "demo" ? demoSource : scope.reason === "day" ? daySource : monthSource)!;
      scope.seedKey = scope.reason === "month" ? `ai-allowance:${month.key}:${args.teamId}:system-split-v1`
        : scope.pairs[0].committedKey.replace(/:committed$/, ":seeded");
      scope.field = "total";
      scope.endsAt = billedAllowancePeriod(kind, period).endsAt;
      scope.billedTtlSeconds = billedAllowancePeriod(kind, period).ttlSeconds;
    }
    if (aiAllowancePeriod().endDate !== month.endDate) {
      if (retry) throw new Error("AI allowance period unavailable");
      return reservePlanAllowance({ ...args, billed }, true);
    }
  }
  const keys: string[] = [];
  const encoded = scopes.map((scope) => ({ ...scope,
    pairs: scope.pairs.map((value) => [keys.push(value.committedKey), keys.push(value.reservationsKey)]),
    pending: scope.pendingKey ? keys.push(scope.pendingKey) : undefined,
  }));
  const amount = args.amountMicroUsd ?? usdToMicroUsd(args.amountUsd);
  const originalScopes = scopes.map((scope) => ({ ...scope.pairs[scope.writeIndex - 1], ttlSeconds: scope.ttlSeconds }));
  const call: BilledCall | undefined = billed ? args.billedCall ?? { teamId: args.teamId ?? "demo", userId: args.userId ?? 0, reservationId: randomUUID() } : undefined;
  const id = `${call?.reservationId ?? randomUUID()}|${JSON.stringify(originalScopes.map((scope) => [scope.committedKey, scope.reservationsKey, scope.ttlSeconds, ...(call ? [amount, call] : [])]))}|${amount}`;
  const redis = await getRedis();
  const followsRealSpend = await allowanceFollowsRealSpend(args.userId ?? null);
  const reserve = async () => {
    const decision = await redis.eval(RESERVE_SCOPES_SCRIPT, keys.length, ...keys,
      JSON.stringify(encoded), String(Date.now()), String(amount), String(Date.now() + RESERVATION_TTL_MS), id, ...(observe ? ["1"] : []));
    if (Array.isArray(decision) && decision[3]) {
      for (const call of JSON.parse(String(decision[3])) as BilledCall[]) logBilledRelease(call, "expiry");
    }
    return decision;
  };
  let billedDecision = call ? await reserveBilledScopes({ keys, encoded, amount, id, call, month: month.key, day: month.endDate }) : null;
  if (billedDecision?.retry) {
    if (retry) throw new Error(`AI allowance unavailable: ${billedDecision.retry}`);
    return reservePlanAllowance({ ...args, billed }, true);
  }
  let decision = billedDecision?.decision ?? await reserve();
  let accepted = Number(Array.isArray(decision) ? decision[0] : decision);
  if (accepted !== 1 && scopes[-accepted - 1]?.reason === "month" && args.teamId && followsRealSpend && (!billed || scopes[-accepted - 1].source?.mode === "v1")) {
    const scope = scopes[-accepted - 1];
    let resynced = false;
    for (const [index, { committedKey }] of scope.pairs.entries()) {
      const lanePrefix = committedKey.replace(/:committed$/, "");
      const recentSettledKey = `${lanePrefix}:recent-settled`;
      const changed = await resyncToGatewaySpend({
        committedKey, gatewayApiKey: args.gatewayApiKey, journalStartedKey: `${recentSettledKey}-since`,
        lane: index === 0 ? "visible" : "system", legacyPendingKey: scope.pendingKey!, lockKey: `${lanePrefix}:gateway-resync-lock`,
        month, recentSettledKey, redis, teamId: args.teamId,
      });
      resynced = changed || resynced;
    }
    if (resynced) {
      billedDecision = call ? await reserveBilledScopes({ keys, encoded, amount, id, call, month: month.key, day: month.endDate }) : null;
      decision = billedDecision?.decision ?? await reserve();
      accepted = Number(Array.isArray(decision) ? decision[0] : decision);
    }
  }
  if (billedDecision?.retry) {
    if (retry) throw new Error(`AI allowance unavailable: ${billedDecision.retry}`);
    return reservePlanAllowance({ ...args, billed }, true);
  }
  if (billedDecision) for (const detail of billedDecision.details) console.info(JSON.stringify({
    event: "ai-allowance-billed-decision", ...call, decision: accepted === 1 ? "allow" : "refuse", ...detail,
  }));
  if (accepted !== 1) {
    const refused = scopes[-accepted - 1];
    if (!refused) throw new Error("Invalid AI allowance reservation response");
    if (observe && Array.isArray(decision)) await recordAllowanceRefusal({
      teamId: args.teamId ?? null, reason: refused.reason, lane: args.lane ?? "visible", cap: refused.cap,
      committed: Number(decision[1]), liveHolds: Number(decision[2]), requestedHold: amount, policyMode: "plan",
      fundingSource,
    }, month.key);
    throw new SharedAiAllowanceExceededError(month.key, refused.reason);
  }
  return { id, scopes: originalScopes, ...(call ? { billedCall: call } : {}) };
}

export async function settlePlanAllowance(reservation: PlanAllowanceReservation, actualUsd: number, reason: HoldReleaseReason = "finish"): Promise<void> {
  if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new Error("Invalid settled AI allowance cost");
  const keys: string[] = [];
  const scopes = reservation.scopes.map((scope) => [keys.push(scope.committedKey), keys.push(scope.reservationsKey), scope.ttlSeconds]);
  const redis = await getRedis();
  const now = Date.now();
  const removed = await redis.eval(SETTLE_SCOPES_SCRIPT, keys.length, ...keys, JSON.stringify(scopes), reservation.id, String(usdToMicroUsd(actualUsd)),
    String(now), String(now - GATEWAY_REPORT_DELAY_WINDOW_MS));
  if (Number(removed) > 0 && reservation.billedCall) logBilledRelease(reservation.billedCall, reason);
}
