import { wrapLanguageModel, type LanguageModel } from "ai";
import prisma from "@/lib/prisma";
import { HTPR_7732_BASETEN_BYOK_FLAG } from "@/lib/flags/definitions/htpr-7732-baseten-byok";
import { HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG } from "@/lib/flags/definitions/htpr-7634-openai-only-default";
import { decryptByokSecret } from "@/lib/crypto/byokCipher";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  isVercelAiGatewayKey,
  registerManagedGatewayKey,
  resolveAiModel,
  inheritAiModelUsage,
  configureAiModelUsage,
  aiUsageProviderForCredential,
  providerOptionsForAiModel,
  type AiGatewayFeature,
  type AiModelCredential,
  type GatewayFundingSource,
  type ModelProviderId,
} from "@/app/api/ai/_lib/modelProvider";
import {
  getAiModelDefinition,
  getAiModelOptionById,
  isHaiku55Model,
  type AiDefaultModelContext,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import {
  BASETEN_MODEL_SLUGS,
  getAiProviderInfo,
  isByokProviderRestrictedInGdprSafeMode,
  isGdprSafeModeEnabled,
  resolveTeamProviderEnabled,
  type TByokProviderKey,
} from "@/lib/aiProviders";
import {
  parseCustomEndpointConfig,
  type CustomEndpointConfig,
} from "@/lib/ai/customEndpoint";
import { MANAGED_TEAM_GATEWAY_PROVIDER } from "@/app/api/ai/_lib/managedGatewayKeys";
import { backgroundClaudeModelEnabled, haiku55ModelEnabled, storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { previousModelForFailedStream } from "@/app/api/ai/chat/stream/modelFallback";
import {
  isPlatformAiCredential,
  resolveSideCallFunding,
  resolveTeamAiFunding,
  TeamKeyOnlyRefusal,
} from "@/lib/ai/teamAiFunding";

export type ByokProviderFlag = {
  provider?: string | null;
  enabled?: boolean | null;
  ciphertext?: string | null;
};

export type ByokLookupContext = {
  teamId?: unknown;
  trustedTeamId?: unknown;
  projectId?: number | null;
  userId?: number | null;
  agentId?: string | null;
  teamScope?: import("@/lib/mcp/auth/types").AgentTokenTeamScope | null;
};

function normalizeTeamId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

async function resolveLookupTeamId(lookup?: ByokLookupContext) {
  let teamId: string | null = null;
  const projectId = lookup?.projectId;

  if (projectId != null) {
    const userId = lookup?.userId;
    if (!userId) {
      const trustedTeamId = normalizeTeamId(lookup?.trustedTeamId);
      if (!trustedTeamId) throw new TeamKeyOnlyRefusal();
      if (lookup?.teamScope != null && trustedTeamId !== lookup.teamScope.teamId) throw new Error("Project not found or access denied");
      return trustedTeamId;
    }

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: "Normal",
        ...getProjectWhere(userId, lookup?.agentId, lookup?.teamScope),
      },
      select: { teamId: true },
    });
    teamId = project?.teamId ?? null;
    if (!teamId) {
      if (lookup?.teamScope != null) throw new Error("Project not found or access denied");
      return undefined;
    }
  } else if (lookup?.trustedTeamId != null) {
    teamId = normalizeTeamId(lookup.trustedTeamId);
  } else {
    teamId = normalizeTeamId(lookup?.teamId);
    const userId = lookup?.userId;
    if (!teamId || !userId) return null;
    const accessibleTeam = await prisma.team.findFirst({
      where: {
        id: teamId,
        OR: [
          { googleAccount: { userId } },
          { members: { some: { userId, status: "Accepted" } } },
        ],
      },
      select: { id: true },
    });
    teamId = accessibleTeam?.id ?? null;
  }

  if (lookup?.teamScope != null && teamId !== lookup.teamScope.teamId) throw new Error("Project not found or access denied");
  return teamId;
}

async function resolveTeamByokSecret(
  provider: TByokProviderKey | typeof MANAGED_TEAM_GATEWAY_PROVIDER,
  lookup?: ByokLookupContext,
  options?: { includeDisabled?: boolean; onResolved?: (row: { id: string; updatedAt: Date }) => void }
) {
  const teamId = await resolveLookupTeamId(lookup);
  if (!teamId) return undefined;

  const row = await prisma.teamByokApiKey.findUnique({
    where: { teamId_provider: { teamId, provider } },
    select: {
      enabled: true,
      ciphertext: true,
      ...(options?.onResolved ? { id: true, updatedAt: true } : {}),
      team: { select: { aiProviderSettings: true } },
    },
  });

  if ((row?.enabled || options?.includeDisabled) && row?.ciphertext?.trim()) {
    const decrypted = decryptByokSecret(row.ciphertext);
    if (isGdprSafeModeEnabled(row?.team?.aiProviderSettings)) {
      if (
        provider !== MANAGED_TEAM_GATEWAY_PROVIDER &&
        isByokProviderRestrictedInGdprSafeMode(provider)
      ) {
        return undefined;
      }
      if (
        provider === "custom" &&
        parseCustomEndpointConfig(decrypted)?.gdprCompliant !== true
      ) {
        return undefined;
      }
    }
    if (options?.onResolved) options.onResolved(row);
    return decrypted;
  }

  return undefined;
}

async function resolveAgentByokSecret(
  provider: TByokProviderKey,
  lookup?: ByokLookupContext
) {
  const agentId =
    typeof lookup?.agentId === "string" ? lookup.agentId.trim() : "";
  if (!agentId) return undefined;

  const row = await prisma.agentByokApiKey.findUnique({
    where: { agentId_provider: { agentId, provider } },
    select: { enabled: true, ciphertext: true },
  });
  if (!row?.enabled) return undefined;

  const ciphertext = row.ciphertext?.trim();
  return ciphertext ? decryptByokSecret(ciphertext) : undefined;
}

export async function resolveAgentByokApiKey(
  provider: TByokProviderKey,
  lookup?: ByokLookupContext
) {
  if (provider === "baseten") return undefined;
  const decrypted = await resolveAgentByokSecret(provider, lookup);
  if (!decrypted) return undefined;
  if (provider !== "custom") return decrypted;
  return parseCustomEndpointConfig(decrypted)?.apiKey;
}

async function resolveLookupPlan(lookup?: ByokLookupContext) {
  const teamId = await resolveLookupTeamId(lookup);
  if (!teamId) return undefined;
  return storePlanIdForProject(null, teamId);
}

function getSharedIncludedAllowanceGatewayKey(plan: string | undefined) {
  if (plan !== "Free" && plan !== "BYOK") return undefined;

  const sharedGatewayKey = process.env.AI_GATEWAY_API_KEY?.trim();
  return isVercelAiGatewayKey(sharedGatewayKey)
    ? sharedGatewayKey
    : undefined;
}

export type TeamGatewayFunding = {
  apiKey: string;
  source: GatewayFundingSource;
  managedKeyId?: string;
  managedKeyUpdatedAt?: string;
};

function managedFunding(apiKey: string): TeamGatewayFunding {
  registerManagedGatewayKey(apiKey);
  return { apiKey, source: "managed" };
}

export async function resolveAiFallbackCredential(
  loadCredential: () => Promise<AiModelCredential | undefined>,
  originalError: unknown,
): Promise<AiModelCredential | undefined> {
  try {
    return await loadCredential();
  } catch {
    throw originalError;
  }
}

export async function resolveTeamByokApiKey(
  provider: TByokProviderKey,
  lookup?: ByokLookupContext,
  options?: { includeDisabled?: boolean }
) {
  const decrypted = await resolveTeamByokSecret(provider, lookup, options);
  if (!decrypted) return undefined;
  if (provider !== "custom") return decrypted;
  return parseCustomEndpointConfig(decrypted)?.apiKey;
}

export async function resolveTeamCustomEndpoint(
  lookup?: ByokLookupContext,
  options?: { includeDisabled?: boolean }
): Promise<CustomEndpointConfig | undefined> {
  const decrypted = await resolveTeamByokSecret("custom", lookup, options);
  return decrypted ? parseCustomEndpointConfig(decrypted) ?? undefined : undefined;
}

async function isByokProviderAllowedForLookup(
  provider: TByokProviderKey,
  lookup?: ByokLookupContext
) {
  if (!isByokProviderRestrictedInGdprSafeMode(provider)) return true;

  const teamId = await resolveLookupTeamId(lookup);
  if (!teamId) return false;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { aiProviderSettings: true },
  });
  return !isGdprSafeModeEnabled(team?.aiProviderSettings);
}

async function isCustomEndpointAllowedForLookup(
  config: CustomEndpointConfig,
  lookup?: ByokLookupContext
) {
  if (config.gdprCompliant) return true;

  const teamId = await resolveLookupTeamId(lookup);
  if (!teamId) return false;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { aiProviderSettings: true },
  });
  return !isGdprSafeModeEnabled(team?.aiProviderSettings);
}

export async function getByokApiKeyForProvider(
  provider: TByokProviderKey,
  flags?: ByokProviderFlag[] | null,
  lookup?: ByokLookupContext,
  options?: {
    resolveOpenRouterWithoutFlag?: boolean;
    resolveWithoutFlag?: boolean;
  }
) {
  if (provider === "baseten") {
    const { isFeatureEnabled } = await import("@/lib/flags");
    if (!(await isFeatureEnabled(HTPR_7732_BASETEN_BYOK_FLAG, lookup?.userId ?? 0))) return undefined;
    const plan = await resolveLookupPlan(lookup);
    if (!plan || plan === "Free") return undefined;
    return resolveTeamByokApiKey("baseten", lookup);
  }

  if (lookup?.agentId && provider !== "custom") {
    const agentKey = await resolveAgentByokApiKey(provider, lookup);
    if (agentKey && (await isByokProviderAllowedForLookup(provider, lookup))) {
      return agentKey;
    }
  }

  const matchingFlag = flags?.find((flag) => {
    const candidate = String(flag.provider ?? "").trim().toLowerCase();
    return candidate === provider && flag.enabled;
  });

  const ciphertext = matchingFlag?.ciphertext?.trim();
  if (ciphertext) {
    const decrypted = decryptByokSecret(ciphertext);
    if (provider === "custom") {
      const config = parseCustomEndpointConfig(decrypted);
      return config && (await isCustomEndpointAllowedForLookup(config, lookup))
        ? config.apiKey
        : undefined;
    }
    if (!(await isByokProviderAllowedForLookup(provider, lookup))) {
      return undefined;
    }
    return decrypted;
  }

  const shouldResolveWithoutFlag =
    options?.resolveWithoutFlag === true ||
    (provider === "openrouter" &&
      options?.resolveOpenRouterWithoutFlag !== false);

  if (shouldResolveWithoutFlag || matchingFlag?.enabled) {
    const teamKey = await resolveTeamByokApiKey(provider, lookup);
    if (teamKey) return teamKey;
  }

  return undefined;
}

export async function getTeamGatewayApiKeyForProvider(
  provider: ModelProviderId,
  lookup?: ByokLookupContext
) {
  const plan = await resolveLookupPlan(lookup);
  if (!plan) return undefined;

  const fundingTeamId = await resolveLookupTeamId(lookup);
  if (fundingTeamId && typeof resolveTeamAiFunding === "function") {
    const decision = await resolveTeamAiFunding(fundingTeamId, { provider, feature: "gateway" });
    if (decision.mode === "byok") return decision.apiKey;
    if (decision.mode === "refused") throw new TeamKeyOnlyRefusal(decision.message);
  }

  if (plan !== "Free") {
    const gatewayKey = await resolveTeamByokApiKey("gateway", lookup);
    if (isVercelAiGatewayKey(gatewayKey)) return gatewayKey;

    const providerGatewayKey = await resolveTeamByokApiKey(provider, lookup);
    if (isVercelAiGatewayKey(providerGatewayKey)) return providerGatewayKey;
  }

  if (plan === "Free" || plan === "BYOK") {
    return getSharedIncludedAllowanceGatewayKey(plan);
  }

  const managedGatewayKey = await resolveTeamByokSecret(
    MANAGED_TEAM_GATEWAY_PROVIDER,
    lookup
  );
  if (isVercelAiGatewayKey(managedGatewayKey)) {
    registerManagedGatewayKey(managedGatewayKey);
    return managedGatewayKey;
  }

  return undefined;
}

export async function getTeamGatewayFunding(
  lookup?: ByokLookupContext,
  options?: { includeProvenance?: boolean },
): Promise<TeamGatewayFunding | undefined> {
  const plan = await resolveLookupPlan(lookup);
  if (!plan) return undefined;

  const fundingTeamId = await resolveLookupTeamId(lookup);
  if (fundingTeamId && typeof resolveTeamAiFunding === "function") {
    const decision = await resolveTeamAiFunding(fundingTeamId, { provider: "gateway", feature: "gateway" });
    if (decision.mode === "byok") return { apiKey: decision.apiKey, source: "customer" };
    if (decision.mode === "refused") return undefined;
  }

  if (plan !== "Free") {
    const gatewayKey = await resolveTeamByokApiKey("gateway", lookup);
    if (isVercelAiGatewayKey(gatewayKey)) {
      return { apiKey: gatewayKey, source: "customer" };
    }

    const openAiGatewayKey = await resolveTeamByokApiKey("openai", lookup);
    if (isVercelAiGatewayKey(openAiGatewayKey)) {
      return { apiKey: openAiGatewayKey, source: "customer" };
    }

    const claudeGatewayKey = await resolveTeamByokApiKey("claude", lookup);
    if (isVercelAiGatewayKey(claudeGatewayKey)) {
      return { apiKey: claudeGatewayKey, source: "customer" };
    }
  }

  if (plan === "Free" || plan === "BYOK") {
    const apiKey = getSharedIncludedAllowanceGatewayKey(plan);
    return apiKey ? { apiKey, source: "shared" } : undefined;
  }

  let metadata: { managedKeyId: string; managedKeyUpdatedAt: string } | undefined;
  const managedGatewayKey = await resolveTeamByokSecret(
    MANAGED_TEAM_GATEWAY_PROVIDER,
    lookup,
    options?.includeProvenance ? { onResolved: (row) => {
      metadata = { managedKeyId: row.id, managedKeyUpdatedAt: row.updatedAt.toISOString() };
    } } : undefined,
  );
  if (isVercelAiGatewayKey(managedGatewayKey)) {
    return { ...managedFunding(managedGatewayKey), ...metadata };
  }

  return undefined;
}

export async function getTeamGatewayApiKey(lookup?: ByokLookupContext) {
  const funding = await getTeamGatewayFunding(lookup);
  if (funding?.apiKey) return funding.apiKey;
  const teamId = await resolveLookupTeamId(lookup);
  if (teamId && typeof resolveTeamAiFunding === "function") {
    const decision = await resolveTeamAiFunding(teamId, { provider: "gateway", feature: "gateway" });
    if (decision.mode === "refused") throw new TeamKeyOnlyRefusal(decision.message);
  }
  return undefined;
}

export async function keyOnlySideCallModel(
  lookup: ByokLookupContext | undefined,
  requestedProvider: string,
): Promise<{ model: LanguageModel; usageProvider: string } | null> {
  const teamId = await resolveLookupTeamId(lookup);
  if (!teamId || typeof resolveSideCallFunding !== "function") return null;
  const decision = await resolveSideCallFunding(teamId, requestedProvider);
  if (decision.mode === "unrestricted") return null;
  if (decision.mode === "refused") throw new TeamKeyOnlyRefusal(decision.message);
  const modelProvider = decision.provider === "openai" ? "openai" : "claude";
  const modelId = modelProvider === "openai" ? "gpt-6-luna" : "claude-haiku-4-5";
  return {
    model: resolveAiModel(modelProvider, modelId, decision.apiKey),
    usageProvider: aiUsageProviderForCredential(modelProvider, decision.apiKey),
  };
}

export async function getByokOrTeamGatewayApiKeyForProvider(
  provider: ModelProviderId,
  flags?: ByokProviderFlag[] | null,
  lookup?: ByokLookupContext,
  options?: { resolveOpenRouterWithoutFlag?: boolean }
) {
  return getByokOrTeamGatewayApiKey(
    provider,
    flags,
    lookup,
    options
  );
}

export async function getByokOrTeamGatewayApiKey(
  provider: TByokProviderKey,
  flags?: ByokProviderFlag[] | null,
  lookup?: ByokLookupContext,
  options?: { resolveOpenRouterWithoutFlag?: boolean }
) {
  if (!(await isByokProviderAllowedForLookup(provider, lookup))) {
    return undefined;
  }

  const plan = await resolveLookupPlan(lookup);
  if (!plan) return undefined;

  const keyOnlyTeamId = await resolveLookupTeamId(lookup);
  if (keyOnlyTeamId && typeof resolveTeamAiFunding === "function") {
    const decision = await resolveTeamAiFunding(keyOnlyTeamId, { provider, feature: "chat" });
    if (decision.mode === "refused") throw new TeamKeyOnlyRefusal(decision.message);
    if (decision.mode === "byok") {
      if (isPlatformAiCredential(decision.apiKey) || isVercelAiGatewayKey(decision.apiKey)) {
        throw new TeamKeyOnlyRefusal();
      }
      return decision.apiKey;
    }
  }

  const byokApiKey =
    plan === "Free"
      ? undefined
      : await getByokApiKeyForProvider(
          provider,
          flags,
          lookup,
          { ...options, resolveWithoutFlag: true }
        );

  if (byokApiKey && !isVercelAiGatewayKey(byokApiKey)) return byokApiKey;

  if (provider === "openrouter" || provider === "custom") return undefined;

  if (isVercelAiGatewayKey(byokApiKey) && !isPlatformAiCredential(byokApiKey)) return byokApiKey;

  return getTeamGatewayApiKey(lookup);
}

export async function getByokOrTeamGatewayApiKeyForModelOption(
  option: TAiModelOption,
  flags?: ByokProviderFlag[] | null,
  lookup?: ByokLookupContext
): Promise<AiModelCredential | undefined> {
  const keyOnlyTeamId = await resolveLookupTeamId(lookup);
  if (keyOnlyTeamId && typeof resolveTeamAiFunding === "function") {
    const definition = option.source === "custom" ? undefined : getAiModelDefinition(option.modelKey);
    const provider = option.source === "custom" || definition?.provider === "custom"
      ? "custom"
      : definition
        ? getAiProviderInfo(definition.provider)?.byokKey ?? definition.provider
        : "gateway";
    const decision = await resolveTeamAiFunding(keyOnlyTeamId, { provider, feature: "chat" });
    if (decision.mode === "refused") throw new TeamKeyOnlyRefusal(decision.message);
    if (decision.mode === "byok") {
      if (isPlatformAiCredential(decision.apiKey) || isVercelAiGatewayKey(decision.apiKey)) {
        throw new TeamKeyOnlyRefusal();
      }
      return decision.apiKey;
    }
  }

  if (option.source === "custom") {
    const plan = await resolveLookupPlan(lookup);
    if (!plan || plan === "Free") return undefined;
    return resolveTeamCustomEndpoint(lookup);
  }

  if (Object.hasOwn(BASETEN_MODEL_SLUGS, option.modelKey)) {
    const basetenKey = await getByokApiKeyForProvider("baseten", undefined, lookup);
    if (basetenKey) {
      const definition = getAiModelDefinition(option.modelKey);
      const providerInfo = definition && definition.provider !== "custom"
        ? getAiProviderInfo(definition.provider)
        : undefined;
      const teamId = await resolveLookupTeamId(lookup);
      const team = teamId ? await prisma.team.findUnique({
        where: { id: teamId },
        select: { aiProviderSettings: true },
      }) : null;
      if (providerInfo && team && resolveTeamProviderEnabled(team.aiProviderSettings, providerInfo.key)) {
        const nativeKey = await getByokApiKeyForProvider(providerInfo.byokKey, flags, lookup, { resolveWithoutFlag: true });
        if (!nativeKey) {
          const funding = await getTeamGatewayFunding(lookup);
          if (funding?.source === "customer") return funding.apiKey;
          return {
            kind: "baseten",
            apiKey: basetenKey,
            modelKey: option.modelKey as keyof typeof BASETEN_MODEL_SLUGS,
          };
        }
      }
    }
  }

  if (option.modelKey === "deepseek-v4.1-flash-fast") {
    if (!(await isByokProviderAllowedForLookup("deepseek", lookup))) return undefined;
    const key = await getByokOrTeamGatewayApiKey("deepseek", flags, lookup);
    if (isVercelAiGatewayKey(key)) return key;
    const teamKey = await resolveTeamByokApiKey("deepseek", lookup);
    return isVercelAiGatewayKey(teamKey) ? teamKey : getTeamGatewayApiKey(lookup);
  }

  const definition = getAiModelDefinition(option.modelKey);
  const providerInfo =
    definition && definition.provider !== "custom"
      ? getAiProviderInfo(definition.provider)
      : undefined;

  if (providerInfo) {
    return getByokOrTeamGatewayApiKey(
      providerInfo.byokKey,
      flags,
      lookup
    );
  }

  return getTeamGatewayApiKey(lookup);
}

async function isAnthropicDisabledForLookup(lookup: ByokLookupContext) {
  const teamId = await resolveLookupTeamId(lookup);
  if (!teamId) return false;
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { aiProviderSettings: true } });
  return !resolveTeamProviderEnabled(team?.aiProviderSettings, "anthropic");
}

async function teamOpenRouterEnabled(lookup: ByokLookupContext) {
  const teamId = await resolveLookupTeamId(lookup);
  const team = teamId ? await prisma.team.findUnique({ where: { id: teamId }, select: { aiProviderSettings: true } }) : null;
  return resolveTeamProviderEnabled(team?.aiProviderSettings, "openrouter");
}

async function openAiOnlyDefaultFlagEnabled(userId: number | null | undefined) {
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG, userId ?? 0);
  } catch {
    return false;
  }
}

const OPENAI_ONLY_DEFAULT_OFF = { openaiOnlyDefaultEnabled: false, hasDirectOpenAiKey: false, hasClaudeRoute: false } as const;

export async function getOpenAiOnlyDefaultContext(lookup: ByokLookupContext, plan?: AiDefaultModelContext["plan"], suppliedFlags?: ByokProviderFlag[] | null) {
  if (!await openAiOnlyDefaultFlagEnabled(lookup.userId)) return OPENAI_ONLY_DEFAULT_OFF;
  const storePlanId = plan ?? await storePlanIdForProject(lookup.projectId, normalizeTeamId(lookup.trustedTeamId ?? lookup.teamId));
  if (storePlanId !== "Pro" && storePlanId !== "AI") return { ...OPENAI_ONLY_DEFAULT_OFF, openaiOnlyDefaultEnabled: true };
  const teamLookup: ByokLookupContext = { ...lookup, agentId: null };
  const storedTeamKey = await getByokApiKeyForProvider("openai", undefined, teamLookup, { resolveWithoutFlag: true });
  const requestKey = (provider: TByokProviderKey) => getByokApiKeyForProvider(provider, suppliedFlags, lookup, { resolveWithoutFlag: true });
  const hasClaudeRoute = Boolean(await requestKey("claude")) ||
    Boolean(await requestKey("gateway")) ||
    (Boolean(await requestKey("openrouter")) && await teamOpenRouterEnabled(lookup)) ||
    isVercelAiGatewayKey(storedTeamKey) ||
    isVercelAiGatewayKey(await resolveTeamByokSecret(MANAGED_TEAM_GATEWAY_PROVIDER, teamLookup));
  let lunaCredential: AiModelCredential | undefined;
  try {
    lunaCredential = await getByokOrTeamGatewayApiKeyForModelOption(getAiModelOptionById("gpt-6-luna")!, suppliedFlags, lookup);
  } catch (error) {
    if (!(typeof TeamKeyOnlyRefusal === "function" && error instanceof TeamKeyOnlyRefusal)) throw error;
  }
  const lunaRunsOnStoredDirectTeamKey = typeof storedTeamKey === "string" && !isVercelAiGatewayKey(storedTeamKey) && lunaCredential === storedTeamKey;
  return { openaiOnlyDefaultEnabled: true, hasDirectOpenAiKey: lunaRunsOnStoredDirectTeamKey, hasClaudeRoute };
}

export async function getAiDefaultModelContext(lookup: ByokLookupContext, haiku55Enabled?: boolean, plan?: AiDefaultModelContext["plan"], suppliedFlags?: ByokProviderFlag[] | null) {
  const haikuDefaultEnabled = true;
  const backgroundClaudeEnabled = await backgroundClaudeModelEnabled?.(lookup.userId) ?? false;
  const enabled = haikuDefaultEnabled || (haiku55Enabled ?? (await haiku55ModelEnabled?.(lookup.userId) ?? false));
  const storePlanId = plan ?? (enabled ? await storePlanIdForProject(lookup.projectId, normalizeTeamId(lookup.trustedTeamId ?? lookup.teamId)) : "Free");
  let byok: { provider: "claude" | "gateway" | "openrouter"; credential: string } | undefined;
  if (enabled && storePlanId && storePlanId !== "Free") {
    for (const provider of ["claude", "gateway", "openrouter"] as const) {
      const teamId = await resolveLookupTeamId(lookup);
      const sideCall = teamId && typeof resolveSideCallFunding === "function"
        ? await resolveSideCallFunding(teamId, provider)
        : { mode: "unrestricted" as const };
      if (sideCall.mode === "refused") continue;
      if (sideCall.mode === "byok") {
        if (sideCall.provider !== "claude" || isPlatformAiCredential(sideCall.apiKey) || isVercelAiGatewayKey(sideCall.apiKey)) continue;
        byok = { provider: "claude", credential: sideCall.apiKey };
        break;
      }
      const credential = await getByokApiKeyForProvider(provider, undefined, lookup, { resolveWithoutFlag: true });
      if (!credential) continue;
      byok = { provider, credential };
      break;
    }
  }
  const openAiOnlyContext = await getOpenAiOnlyDefaultContext(lookup, storePlanId, suppliedFlags);
  const anthropicDisabled = backgroundClaudeEnabled && await isAnthropicDisabledForLookup(lookup);
  return { haiku55Enabled: enabled, haikuDefaultEnabled, backgroundClaudeEnabled, anthropicDisabled, plan: storePlanId, hasByok: Boolean(byok), byok, ...openAiOnlyContext };
}

export function resolveAutomaticAiModel(
  provider: ModelProviderId,
  modelId: string,
  credential: AiModelCredential | undefined,
  context: { haiku55Enabled: boolean; lookup: ByokLookupContext; feature: AiGatewayFeature },
): LanguageModel {
  const model = resolveAiModel(provider, modelId, credential);
  if (!context.haiku55Enabled || !isHaiku55Model(modelId)) return model;

  const wrapped = wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate, params }) => {
        try {
          return await doGenerate();
        } catch (error) {
          const sameModelRetry = !params.abortSignal?.aborted && Boolean(await backgroundClaudeModelEnabled?.(context.lookup.userId));
          if (params.abortSignal?.aborted || !previousModelForFailedStream(modelId, error, false, false, true, sameModelRetry)) throw error;
          if (sameModelRetry) {
            console.warn(`[ai-model-fallback] ${modelId} retry on the same model`);
            try {
              return await doGenerate();
            } catch (retryError) {
              console.error(`[ai-model-fallback] ${modelId} failed again; not switching to another model`, retryError);
              throw retryError;
            }
          }
          const teamId = await resolveLookupTeamId(context.lookup);
          if (!teamId) throw error;
          if (typeof resolveTeamAiFunding === "function") {
            const keyOnlyChat = await resolveTeamAiFunding(teamId, { provider: "openai", feature: "chat" });
            if (keyOnlyChat.mode !== "unrestricted") throw error;
          }
          const team = await prisma.team.findUnique({
            where: { id: teamId },
            select: { aiProviderSettings: true },
          });
          if (!team || !resolveTeamProviderEnabled(team.aiProviderSettings, "openai")) throw error;
          const option = getAiModelOptionById("gpt-6-luna")!;
          const fallbackCredential = await resolveAiFallbackCredential(
            () => getByokOrTeamGatewayApiKeyForModelOption(option, undefined, context.lookup), error,
          );
          const fallback = resolveAiModel("openai", option.model, fallbackCredential, option);
          inheritAiModelUsage(fallback, wrapped);
          configureAiModelUsage(fallback, { provider: aiUsageProviderForCredential("openai", fallbackCredential, option) });
          const providerOptions = providerOptionsForAiModel(fallback, context.feature, {
            teamId,
            projectId: context.lookup.projectId,
            userId: context.lookup.userId,
          }, option);
          return (fallback as ReturnType<typeof wrapLanguageModel>).doGenerate({
            ...params,
            providerOptions: providerOptions ?? {},
          });
        }
      },
    },
  });
  inheritAiModelUsage(wrapped, model);
  return wrapped;
}
