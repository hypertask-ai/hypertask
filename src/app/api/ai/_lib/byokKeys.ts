import prisma from "@/lib/prisma";
import { decryptByokSecret } from "@/lib/crypto/byokCipher";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  isVercelAiGatewayKey,
  registerManagedGatewayKey,
  type AiModelCredential,
  type GatewayFundingSource,
  type ModelProviderId,
} from "@/app/api/ai/_lib/modelProvider";
import {
  getAiModelDefinition,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import {
  getAiProviderInfo,
  isByokProviderRestrictedInGdprSafeMode,
  isGdprSafeModeEnabled,
  type TByokProviderKey,
} from "@/lib/aiProviders";
import {
  parseCustomEndpointConfig,
  type CustomEndpointConfig,
} from "@/lib/ai/customEndpoint";
import { MANAGED_TEAM_GATEWAY_PROVIDER } from "@/app/api/ai/_lib/managedGatewayKeys";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";

export type ByokProviderFlag = {
  provider?: string | null;
  enabled?: boolean | null;
  ciphertext?: string | null;
};

export type ByokLookupContext = {
  teamId?: unknown;
  /** Server-derived team identity. Never populate this from request input. */
  trustedTeamId?: unknown;
  projectId?: number | null;
  userId?: number | null;
  /**
   * The native agent running this turn. When that agent carries its own
   * provider key, the call is billed to its provider account instead of the
   * team's shared key (HTPR-5389). Server-derived only, never request input.
   */
  agentId?: string | null;
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
    if (!userId) return undefined;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: "Normal",
        ...getProjectWhere(userId),
      },
      select: { teamId: true },
    });
    teamId = project?.teamId ?? null;
    if (!teamId) return undefined;
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

  return teamId;
}

async function resolveTeamByokSecret(
  provider: TByokProviderKey | typeof MANAGED_TEAM_GATEWAY_PROVIDER,
  lookup?: ByokLookupContext,
  options?: { includeDisabled?: boolean }
) {
  const teamId = await resolveLookupTeamId(lookup);
  if (!teamId) return undefined;

  const row = await prisma.teamByokApiKey.findUnique({
    where: { teamId_provider: { teamId, provider } },
    select: {
      enabled: true,
      ciphertext: true,
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
    return decrypted;
  }

  return undefined;
}

/**
 * The acting agent's own provider key, when it has one for this provider.
 * Returns undefined when the agent has no key, so every caller falls back to
 * the team key exactly as before.
 */
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
};

function managedFunding(apiKey: string): TeamGatewayFunding {
  registerManagedGatewayKey(apiKey);
  return { apiKey, source: "managed" };
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
  // An agent carrying its own key spends on that provider account, so it wins
  // over both request flags and the team key (HTPR-5389).
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

  // A customer-supplied gateway key takes precedence over the team's funded key.
  if (plan !== "Free") {
    const gatewayKey = await resolveTeamByokApiKey("gateway", lookup);
    if (isVercelAiGatewayKey(gatewayKey)) return gatewayKey;

    // Legacy provider slots may contain a customer vck_. Exact known platform
    // values are removed by managed-key provisioning; any remainder is BYOK.
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
): Promise<TeamGatewayFunding | undefined> {
  const plan = await resolveLookupPlan(lookup);
  if (!plan) return undefined;

  // A customer-supplied gateway key takes precedence over the team's funded key.
  if (plan !== "Free") {
    const gatewayKey = await resolveTeamByokApiKey("gateway", lookup);
    if (isVercelAiGatewayKey(gatewayKey)) {
      return { apiKey: gatewayKey, source: "customer" };
    }

    // Legacy provider slots may contain customer gateway credentials. Check
    // both before funded keys so background/system routes honor BYOK too.
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

  const managedGatewayKey = await resolveTeamByokSecret(
    MANAGED_TEAM_GATEWAY_PROVIDER,
    lookup
  );
  if (isVercelAiGatewayKey(managedGatewayKey)) {
    return managedFunding(managedGatewayKey);
  }

  return undefined;
}

export async function getTeamGatewayApiKey(lookup?: ByokLookupContext) {
  return (await getTeamGatewayFunding(lookup))?.apiKey;
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

  // A customer vck_ supplied through legacy provider flags also wins over the
  // funded team allowance. OpenRouter remains direct-key-only above.
  if (isVercelAiGatewayKey(byokApiKey)) return byokApiKey;

  return getTeamGatewayApiKey(lookup);
}

export async function getByokOrTeamGatewayApiKeyForModelOption(
  option: TAiModelOption,
  flags?: ByokProviderFlag[] | null,
  lookup?: ByokLookupContext
): Promise<AiModelCredential | undefined> {
  if (option.source === "custom") {
    const plan = await resolveLookupPlan(lookup);
    if (!plan || plan === "Free") return undefined;
    return resolveTeamCustomEndpoint(lookup);
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
