import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGateway, type ImageModel, type LanguageModel } from "ai";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { reportError } from "@/lib/errors/reportError";
import type { StorePlanKind } from "@/lib/planFromStripePriceId";
import type { TAiModelOption } from "@/lib/aiModelOptions";
import type { TAiProviderKey, TByokProviderKey } from "@/lib/aiProviders";
import type { CustomEndpointConfig } from "@/lib/ai/customEndpoint";
import { BASETEN_MODEL_SLUGS } from "@/lib/aiProviders";

export const PLATFORM_ANTHROPIC_ENV_VAR = "ANTHROPIC_API_KEY";
export const PLATFORM_ANTHROPIC_CREDIT_ENV_VAR = "ANTHROPIC_MONTHLY_CREDIT_USD";
export const DEFAULT_ANTHROPIC_MONTHLY_CREDIT_USD = 200;
export const PLATFORM_ANTHROPIC_USAGE_PROVIDER = "platform:anthropic";

const MICRO_USD_PER_USD = 1_000_000;
const SPEND_CACHE_TTL_MS = 15_000;
const DAY_SECONDS = 24 * 60 * 60;
const MONTH_TTL_SECONDS = 40 * DAY_SECONDS;

export type AiPayer = "customer" | "hypertask";

export type AiFundingRoute =
  | "customer-forced"
  | "customer-byok"
  | "customer-gateway"
  | "hypertask-anthropic"
  | "hypertask-gateway";

export type GatewayFundingSource = "customer" | "managed" | "shared";

export type AnthropicFallbackReason =
  | "anthropic_credit_exhausted"
  | "anthropic_key_missing"
  | "anthropic_error";

export type GatewayFailureReason =
  | "gateway_credit_exhausted"
  | "gateway_refusal"
  | "gateway_error";

export type AiFundingIncidentCause =
  | AnthropicFallbackReason
  | GatewayFailureReason;

export type BasetenCredential = {
  kind: "baseten";
  apiKey: string;
  modelKey: keyof typeof BASETEN_MODEL_SLUGS;
};

export type PlatformAnthropicCredential = {
  kind: "platform-anthropic";
  apiKey: string;
  fallbackGatewayApiKey?: string;
  gatewayFundingSource?: "managed" | "shared";
  anthropicSpentUsd: number;
  anthropicLimitUsd: number;
  month: string;
};

export type AiModelCredential =
  | string
  | CustomEndpointConfig
  | BasetenCredential
  | PlatformAnthropicCredential;

export type AnthropicMonthlyCreditState = {
  month: string;
  limitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  configured: boolean;
  available: boolean;
  fallbackReason: AnthropicFallbackReason | null;
};

export type AiFundingPolicyRow = {
  id: string;
  plan: StorePlanKind | "comped";
  customerKey: "forced" | "direct-or-gateway" | "none";
  anthropicCredit: "available" | "unavailable" | "any";
  payer: AiPayer;
  route: AiFundingRoute;
  fallbackRoute: AiFundingRoute | null;
  gatewayFundingSource: GatewayFundingSource | null;
  autoClaudeOnly: boolean;
};

export const AI_FUNDING_TABLE: readonly AiFundingPolicyRow[] = [
  {
    id: "forced-key",
    plan: "Pro",
    customerKey: "forced",
    anthropicCredit: "any",
    payer: "customer",
    route: "customer-forced",
    fallbackRoute: null,
    gatewayFundingSource: "customer",
    autoClaudeOnly: false,
  },
  {
    id: "byok-customer-key",
    plan: "BYOK",
    customerKey: "direct-or-gateway",
    anthropicCredit: "any",
    payer: "customer",
    route: "customer-byok",
    fallbackRoute: null,
    gatewayFundingSource: "customer",
    autoClaudeOnly: false,
  },
  {
    id: "byok-included-anthropic",
    plan: "BYOK",
    customerKey: "none",
    anthropicCredit: "available",
    payer: "hypertask",
    route: "hypertask-anthropic",
    fallbackRoute: "hypertask-gateway",
    gatewayFundingSource: "shared",
    autoClaudeOnly: true,
  },
  {
    id: "byok-included-gateway",
    plan: "BYOK",
    customerKey: "none",
    anthropicCredit: "unavailable",
    payer: "hypertask",
    route: "hypertask-gateway",
    fallbackRoute: null,
    gatewayFundingSource: "shared",
    autoClaudeOnly: true,
  },
  {
    id: "free-anthropic",
    plan: "Free",
    customerKey: "none",
    anthropicCredit: "available",
    payer: "hypertask",
    route: "hypertask-anthropic",
    fallbackRoute: "hypertask-gateway",
    gatewayFundingSource: "shared",
    autoClaudeOnly: true,
  },
  {
    id: "free-gateway",
    plan: "Free",
    customerKey: "none",
    anthropicCredit: "unavailable",
    payer: "hypertask",
    route: "hypertask-gateway",
    fallbackRoute: null,
    gatewayFundingSource: "shared",
    autoClaudeOnly: true,
  },
  {
    id: "pro-customer-key",
    plan: "Pro",
    customerKey: "direct-or-gateway",
    anthropicCredit: "any",
    payer: "customer",
    route: "customer-byok",
    fallbackRoute: null,
    gatewayFundingSource: "customer",
    autoClaudeOnly: false,
  },
  {
    id: "pro-anthropic",
    plan: "Pro",
    customerKey: "none",
    anthropicCredit: "available",
    payer: "hypertask",
    route: "hypertask-anthropic",
    fallbackRoute: "hypertask-gateway",
    gatewayFundingSource: "managed",
    autoClaudeOnly: true,
  },
  {
    id: "pro-gateway",
    plan: "Pro",
    customerKey: "none",
    anthropicCredit: "unavailable",
    payer: "hypertask",
    route: "hypertask-gateway",
    fallbackRoute: null,
    gatewayFundingSource: "managed",
    autoClaudeOnly: true,
  },
  {
    id: "ai-customer-key",
    plan: "AI",
    customerKey: "direct-or-gateway",
    anthropicCredit: "any",
    payer: "customer",
    route: "customer-byok",
    fallbackRoute: null,
    gatewayFundingSource: "customer",
    autoClaudeOnly: false,
  },
  {
    id: "ai-anthropic",
    plan: "AI",
    customerKey: "none",
    anthropicCredit: "available",
    payer: "hypertask",
    route: "hypertask-anthropic",
    fallbackRoute: "hypertask-gateway",
    gatewayFundingSource: "managed",
    autoClaudeOnly: true,
  },
  {
    id: "ai-gateway",
    plan: "AI",
    customerKey: "none",
    anthropicCredit: "unavailable",
    payer: "hypertask",
    route: "hypertask-gateway",
    fallbackRoute: null,
    gatewayFundingSource: "managed",
    autoClaudeOnly: true,
  },
  {
    id: "comped-anthropic",
    plan: "comped",
    customerKey: "none",
    anthropicCredit: "available",
    payer: "hypertask",
    route: "hypertask-anthropic",
    fallbackRoute: "hypertask-gateway",
    gatewayFundingSource: "shared",
    autoClaudeOnly: true,
  },
  {
    id: "comped-gateway",
    plan: "comped",
    customerKey: "none",
    anthropicCredit: "unavailable",
    payer: "hypertask",
    route: "hypertask-gateway",
    fallbackRoute: null,
    gatewayFundingSource: "shared",
    autoClaudeOnly: true,
  },
];

export type AiFundingDecision = {
  plan: StorePlanKind;
  payer: AiPayer;
  route: AiFundingRoute;
  credential: AiModelCredential | undefined;
  fallbackGatewayCredential?: string;
  gatewayFundingSource?: GatewayFundingSource;
  anthropicCredit: AnthropicMonthlyCreditState;
  forcedProvider?: TByokProviderKey | null;
  directProvider?: TAiProviderKey;
};

export function isPlatformAnthropicCredential(
  credential: unknown,
): credential is PlatformAnthropicCredential {
  return (
    credential !== null &&
    typeof credential === "object" &&
    "kind" in credential &&
    (credential as { kind?: unknown }).kind === "platform-anthropic"
  );
}

export function isBasetenCredential(
  credential: unknown,
): credential is BasetenCredential {
  return (
    credential !== null &&
    typeof credential === "object" &&
    "kind" in credential &&
    (credential as { kind?: unknown }).kind === "baseten"
  );
}

export function isVercelAiGatewayKey(apiKey: unknown): apiKey is string {
  return typeof apiKey === "string" && apiKey.trim().startsWith("vck_");
}

export function platformAnthropicApiKey(): string | undefined {
  return process.env[PLATFORM_ANTHROPIC_ENV_VAR]?.trim() || undefined;
}

export function anthropicMonthlyCreditLimitUsd(): number {
  const raw = process.env[PLATFORM_ANTHROPIC_CREDIT_ENV_VAR]?.trim();
  if (!raw) return DEFAULT_ANTHROPIC_MONTHLY_CREDIT_USD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_ANTHROPIC_MONTHLY_CREDIT_USD;
}

export function utcMonthKey(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function utcMonthBounds(month: string): { start: Date; end: Date } {
  const [year, monthIndex] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthIndex - 1, 1)),
    end: new Date(Date.UTC(year, monthIndex, 1)),
  };
}

export function isAnthropicModelId(modelId: string | null | undefined): boolean {
  const normalized = (modelId ?? "").trim().toLowerCase();
  return (
    normalized.startsWith("claude-") ||
    normalized.startsWith("anthropic/claude-")
  );
}

export function toDirectAnthropicModelId(
  modelId: string,
  modelOption?: TAiModelOption,
): string {
  if (modelOption?.directModel) return modelOption.directModel;
  const bare = modelId.trim().replace(/^anthropic\//i, "");
  return bare.replace(/^(claude-(?:haiku|sonnet|opus)-\d+)\.(\d+)/i, "$1-$2");
}

export function toGatewayAnthropicModelSlug(
  modelId: string,
  modelOption?: TAiModelOption,
): string {
  const raw = (modelOption?.model ?? modelId).trim();
  const bare = raw.replace(/^anthropic\//i, "");
  const dotted = bare.replace(
    /^(claude-(?:haiku|sonnet|opus)-\d+)-(\d+)$/i,
    "$1.$2",
  );
  return `anthropic/${dotted}`;
}

export function isHypertaskPaidAutoContext(input: {
  plan?: StorePlanKind | null;
  byokProviderFlags?: ReadonlyArray<{ provider?: string | null; enabled?: boolean | null }> | null;
  forcedProvider?: TByokProviderKey | null;
  payer?: AiPayer | null;
}): boolean {
  if (input.payer === "customer") return false;
  if (input.payer === "hypertask") return true;
  if (input.forcedProvider) return false;
  if (input.plan === "BYOK") {
    const hasEnabledCustomerKey = Boolean(
      input.byokProviderFlags?.some((flag) => flag.enabled && Boolean(flag.provider)),
    );
    return !hasEnabledCustomerKey;
  }
  return input.plan === "Free" || input.plan === "Pro" || input.plan === "AI" || !input.plan;
}

export function isCustomerPaidCredential(
  credential: unknown,
  sharedGatewayKey = process.env.AI_GATEWAY_API_KEY?.trim(),
  isManagedGatewayKey?: (key: string) => boolean,
): boolean {
  if (!credential) return false;
  if (isPlatformAnthropicCredential(credential)) return false;
  if (typeof credential === "object") return true;
  if (typeof credential !== "string") return false;
  const trimmed = credential.trim();
  if (!trimmed) return false;
  if (sharedGatewayKey && trimmed === sharedGatewayKey) return false;
  if (isManagedGatewayKey?.(trimmed)) return false;
  return true;
}

export function createFundingGatewayClient(options: { apiKey: string }) {
  return createGateway({ apiKey: options.apiKey });
}

export function createFundingGatewayLanguageModel(
  modelSlug: string,
  gatewayApiKey: string,
): LanguageModel {
  return createGateway({ apiKey: gatewayApiKey })(modelSlug);
}

export function createFundingGatewayImageModel(
  modelSlug: string,
  gatewayApiKey: string,
): ImageModel {
  return createGateway({ apiKey: gatewayApiKey }).imageModel(modelSlug);
}

export function createFundingAnthropicLanguageModel(
  modelId: string,
  apiKey: string,
): LanguageModel {
  return createAnthropic({ apiKey })(modelId);
}

export function createFundingOpenAiLanguageModel(
  modelId: string,
  options: {
    apiKey: string;
    baseURL?: string;
    fetch?: typeof fetch;
    useChat?: boolean;
  },
): LanguageModel {
  const client = createOpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return options.useChat ? client.chat(modelId) : client(modelId);
}

export function createFundingOpenRouterLanguageModel(
  modelId: string,
  apiKey: string,
): LanguageModel {
  return createOpenRouter({ apiKey })(modelId);
}

export function createAnthropicWebSearchTool(apiKey?: string) {
  return createAnthropic({ apiKey: apiKey ?? "" }).tools.webSearch_20250305({
    maxUses: 5,
  });
}

export function createOpenAiWebSearchTool(apiKey?: string) {
  return createOpenAI({ apiKey: apiKey ?? "" }).tools.webSearch();
}

let spendCache:
  | { month: string; spentUsd: number; expiresAt: number }
  | undefined;
const localSpendDeltaUsd = new Map<string, number>();
const reportedIncidentKeys = new Set<string>();

export function resetAiFundingStateForTests() {
  spendCache = undefined;
  localSpendDeltaUsd.clear();
  reportedIncidentKeys.clear();
}

function anthropicSpendRedisKey(month: string) {
  return `ai-funding:anthropic-spend-micro-usd:${month}`;
}

function incidentDedupeRedisKey(cause: AiFundingIncidentCause, day: string) {
  return `ai-funding:incident:${cause}:${day}`;
}

async function readAnthropicSpendFromUsageTable(month: string): Promise<number | null> {
  try {
    if (typeof prisma?.aiUsage?.aggregate !== "function") return null;
    const { start, end } = utcMonthBounds(month);
    const result = await prisma.aiUsage.aggregate({
      where: {
        provider: PLATFORM_ANTHROPIC_USAGE_PROVIDER,
        createdAt: { gte: start, lt: end },
      },
      _sum: { costUsd: true },
    });
    const sum = result?._sum?.costUsd;
    return typeof sum === "number" && Number.isFinite(sum) && sum >= 0 ? sum : 0;
  } catch {
    return null;
  }
}

async function readAnthropicSpendFromRedis(month: string): Promise<number | null> {
  try {
    const redis = await getRedis();
    const raw = await redis.get(anthropicSpendRedisKey(month));
    if (raw == null) return null;
    const micro = Number(raw);
    return Number.isFinite(micro) && micro >= 0 ? micro / MICRO_USD_PER_USD : null;
  } catch {
    return null;
  }
}

export async function getAnthropicMonthlySpendUsd(now = new Date()): Promise<number> {
  const month = utcMonthKey(now);
  if (spendCache && spendCache.month === month && spendCache.expiresAt > now.getTime()) {
    return Math.max(spendCache.spentUsd, localSpendDeltaUsd.get(month) ?? 0);
  }
  const [dbSpend, redisSpend] = await Promise.all([
    readAnthropicSpendFromUsageTable(month),
    readAnthropicSpendFromRedis(month),
  ]);
  const localSpend = localSpendDeltaUsd.get(month) ?? 0;
  const spentUsd = Math.max(dbSpend ?? 0, redisSpend ?? 0, localSpend);
  if (dbSpend !== null && redisSpend === null && dbSpend > 0) {
    try {
      const redis = await getRedis();
      const micro = Math.ceil(dbSpend * MICRO_USD_PER_USD);
      await redis.set(anthropicSpendRedisKey(month), String(micro), "EX", MONTH_TTL_SECONDS, "NX");
    } catch {}
  }
  spendCache = {
    month,
    spentUsd,
    expiresAt: now.getTime() + SPEND_CACHE_TTL_MS,
  };
  return spentUsd;
}

export async function recordAnthropicMonthlySpend(
  costUsd: number | null | undefined,
  now = new Date(),
): Promise<void> {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd <= 0) return;
  const month = utcMonthKey(now);
  const nextLocal = (localSpendDeltaUsd.get(month) ?? 0) + costUsd;
  localSpendDeltaUsd.set(month, nextLocal);
  if (spendCache && spendCache.month === month) {
    spendCache = {
      ...spendCache,
      spentUsd: Math.max(spendCache.spentUsd + costUsd, nextLocal),
    };
  }
  try {
    const redis = await getRedis();
    const key = anthropicSpendRedisKey(month);
    const micro = Math.ceil(costUsd * MICRO_USD_PER_USD);
    await redis.incrby(key, micro);
    await redis.expire(key, MONTH_TTL_SECONDS);
  } catch {}
}

export async function getAnthropicMonthlyCreditState(
  now = new Date(),
): Promise<AnthropicMonthlyCreditState> {
  const month = utcMonthKey(now);
  const limitUsd = anthropicMonthlyCreditLimitUsd();
  const configured = Boolean(platformAnthropicApiKey());
  const spentUsd = await getAnthropicMonthlySpendUsd(now);
  const remainingUsd = Math.max(0, limitUsd - spentUsd);
  if (!configured) {
    return {
      month,
      limitUsd,
      spentUsd,
      remainingUsd,
      configured: false,
      available: false,
      fallbackReason: "anthropic_key_missing",
    };
  }
  if (remainingUsd <= 0) {
    return {
      month,
      limitUsd,
      spentUsd,
      remainingUsd: 0,
      configured: true,
      available: false,
      fallbackReason: "anthropic_credit_exhausted",
    };
  }
  return {
    month,
    limitUsd,
    spentUsd,
    remainingUsd,
    configured: true,
    available: true,
    fallbackReason: null,
  };
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function incidentTitle(cause: AiFundingIncidentCause): string {
  switch (cause) {
    case "anthropic_credit_exhausted":
      return "[URGENT] AI fell back to Vercel Gateway: monthly Anthropic credit used up";
    case "anthropic_key_missing":
      return "[URGENT] AI fell back to Vercel Gateway: ANTHROPIC_API_KEY is missing";
    case "anthropic_error":
      return "[URGENT] AI fell back to Vercel Gateway: direct Anthropic call failed";
    case "gateway_credit_exhausted":
      return "[URGENT] Vercel AI Gateway failed: credit exhausted";
    case "gateway_refusal":
      return "[URGENT] Vercel AI Gateway failed: request refused";
    case "gateway_error":
      return "[URGENT] Vercel AI Gateway failed: provider error";
  }
}

export function classifyGatewayFailureCause(error: unknown): GatewayFailureReason {
  const detail = extractErrorSummary(error);
  const status = detail.statusCode;
  const text = detail.message.toLowerCase();
  if (
    status === 402 ||
    /insufficient|credit|balance|quota|billing|payment required|out of funds|depleted/.test(text)
  ) {
    return "gateway_credit_exhausted";
  }
  if (status === 401 || status === 403 || /refus|forbidden|unauthorized|blocked|invalid.*key/.test(text)) {
    return "gateway_refusal";
  }
  return "gateway_error";
}

export function extractErrorSummary(error: unknown): {
  message: string;
  statusCode: number | null;
  errorName: string;
} {
  let current = error;
  const seen = new Set<unknown>();
  let message = "";
  let statusCode: number | null = null;
  let errorName = "Error";
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "string") {
      if (!message) message = current;
      break;
    }
    if (typeof current !== "object") break;
    const record = current as {
      name?: unknown;
      message?: unknown;
      status?: unknown;
      statusCode?: unknown;
      cause?: unknown;
      lastError?: unknown;
    };
    if (typeof record.name === "string" && record.name && errorName === "Error") {
      errorName = record.name;
    }
    if (typeof record.message === "string" && record.message && !message) {
      message = record.message;
    }
    const status = record.statusCode ?? record.status;
    if (typeof status === "number" && Number.isInteger(status) && statusCode === null) {
      statusCode = status;
    }
    current = record.lastError ?? record.cause;
  }
  return {
    message: message || "Unknown AI provider failure",
    statusCode,
    errorName,
  };
}

async function claimDailyIncidentSlot(
  cause: AiFundingIncidentCause,
  day: string,
): Promise<boolean> {
  const memoryKey = `${cause}:${day}`;
  if (reportedIncidentKeys.has(memoryKey)) return false;
  try {
    const redis = await getRedis();
    const claimed = await redis.set(
      incidentDedupeRedisKey(cause, day),
      "1",
      "EX",
      DAY_SECONDS,
      "NX",
    );
    if (!claimed) {
      reportedIncidentKeys.add(memoryKey);
      return false;
    }
  } catch {}
  reportedIncidentKeys.add(memoryKey);
  return true;
}

export async function reportAiFundingIncident(args: {
  cause: AiFundingIncidentCause;
  reason: string;
  modelId?: string;
  teamId?: string | null;
  feature?: string | null;
  anthropicCredit?: AnthropicMonthlyCreditState;
  error?: unknown;
  now?: Date;
}): Promise<boolean> {
  const now = args.now ?? new Date();
  const day = utcDayKey(now);
  const claimed = await claimDailyIncidentSlot(args.cause, day);
  if (!claimed) return false;

  const credit = args.anthropicCredit ?? (await getAnthropicMonthlyCreditState(now));
  const detail = args.error ? extractErrorSummary(args.error) : null;
  const reasonText = detail
    ? `${args.reason} (${detail.errorName}${detail.statusCode ? ` HTTP ${detail.statusCode}` : ""}: ${detail.message})`
    : args.reason;
  const message =
    `${incidentTitle(args.cause)} — ${reasonText}. ` +
    `Month ${credit.month} Anthropic spend: ${formatUsd(credit.spentUsd)} / ${formatUsd(credit.limitUsd)} ` +
    `(remaining ${formatUsd(credit.remainingUsd)}).`;

  await reportError({
    title: incidentTitle(args.cause),
    message,
    source: "server",
    url: "/api/ai",
    urgent: true,
    dedupeSeconds: DAY_SECONDS,
    fingerprintKey: `ai-funding:${args.cause}:${day}`,
    extra: {
      cause: args.cause,
      reason: reasonText.slice(0, 300),
      month: credit.month,
      anthropicSpentUsd: Number(credit.spentUsd.toFixed(6)),
      anthropicLimitUsd: credit.limitUsd,
      anthropicRemainingUsd: Number(credit.remainingUsd.toFixed(6)),
      anthropicConfigured: credit.configured,
      modelId: args.modelId ?? null,
      teamId: args.teamId ?? null,
      feature: args.feature ?? null,
      statusCode: detail?.statusCode ?? null,
    },
  }).catch(() => undefined);
  return true;
}

export async function resolveHypertaskAnthropicCredential(args: {
  fallbackGatewayApiKey?: string;
  gatewayFundingSource?: "managed" | "shared";
  modelId?: string;
  teamId?: string | null;
  feature?: string | null;
  now?: Date;
}): Promise<{
  route: "hypertask-anthropic" | "hypertask-gateway";
  credential: PlatformAnthropicCredential | string | undefined;
  anthropicCredit: AnthropicMonthlyCreditState;
}> {
  const now = args.now ?? new Date();
  const anthropicCredit = await getAnthropicMonthlyCreditState(now);
  const anthropicKey = platformAnthropicApiKey();

  if (anthropicCredit.available && anthropicKey) {
    return {
      route: "hypertask-anthropic",
      credential: {
        kind: "platform-anthropic",
        apiKey: anthropicKey,
        fallbackGatewayApiKey: args.fallbackGatewayApiKey,
        gatewayFundingSource: args.gatewayFundingSource,
        anthropicSpentUsd: anthropicCredit.spentUsd,
        anthropicLimitUsd: anthropicCredit.limitUsd,
        month: anthropicCredit.month,
      },
      anthropicCredit,
    };
  }

  if (args.fallbackGatewayApiKey && anthropicCredit.fallbackReason) {
    const reason =
      anthropicCredit.fallbackReason === "anthropic_credit_exhausted"
        ? `Monthly Anthropic credit reached ${formatUsd(anthropicCredit.spentUsd)} of ${formatUsd(anthropicCredit.limitUsd)}`
        : `${PLATFORM_ANTHROPIC_ENV_VAR} is unset in server environment`;
    await reportAiFundingIncident({
      cause: anthropicCredit.fallbackReason,
      reason,
      modelId: args.modelId,
      teamId: args.teamId,
      feature: args.feature,
      anthropicCredit,
      now,
    });
  }

  return {
    route: "hypertask-gateway",
    credential: args.fallbackGatewayApiKey,
    anthropicCredit,
  };
}

export function resolveAiFundingTableDecision(args: {
  plan: StorePlanKind;
  isComped?: boolean;
  forcedKey?: { provider: TByokProviderKey; apiKey: string } | null;
  customerKey?: AiModelCredential;
  isCustomerGateway?: boolean;
  hypertaskGatewayKey?: string;
  hypertaskGatewaySource?: "managed" | "shared";
  isAnthropicModel: boolean;
  anthropicCredit: AnthropicMonthlyCreditState;
  anthropicApiKey?: string;
}): AiFundingDecision {
  if (args.forcedKey) {
    return {
      plan: args.plan,
      payer: "customer",
      route: "customer-forced",
      credential: args.forcedKey.apiKey,
      gatewayFundingSource: isVercelAiGatewayKey(args.forcedKey.apiKey)
        ? "customer"
        : undefined,
      anthropicCredit: args.anthropicCredit,
      forcedProvider: args.forcedKey.provider,
    };
  }

  if (args.plan !== "Free" && args.customerKey) {
    return {
      plan: args.plan,
      payer: "customer",
      route: args.isCustomerGateway ? "customer-gateway" : "customer-byok",
      credential: args.customerKey,
      gatewayFundingSource: args.isCustomerGateway ? "customer" : undefined,
      anthropicCredit: args.anthropicCredit,
    };
  }

  if (args.isAnthropicModel && args.anthropicCredit.available && args.anthropicApiKey) {
    return {
      plan: args.plan,
      payer: "hypertask",
      route: "hypertask-anthropic",
      credential: {
        kind: "platform-anthropic",
        apiKey: args.anthropicApiKey,
        fallbackGatewayApiKey: args.hypertaskGatewayKey,
        gatewayFundingSource: args.hypertaskGatewaySource,
        anthropicSpentUsd: args.anthropicCredit.spentUsd,
        anthropicLimitUsd: args.anthropicCredit.limitUsd,
        month: args.anthropicCredit.month,
      },
      fallbackGatewayCredential: args.hypertaskGatewayKey,
      gatewayFundingSource: args.hypertaskGatewaySource,
      anthropicCredit: args.anthropicCredit,
    };
  }

  return {
    plan: args.plan,
    payer: "hypertask",
    route: "hypertask-gateway",
    credential: args.hypertaskGatewayKey,
    fallbackGatewayCredential: args.hypertaskGatewayKey,
    gatewayFundingSource: args.hypertaskGatewaySource,
    anthropicCredit: args.anthropicCredit,
  };
}
