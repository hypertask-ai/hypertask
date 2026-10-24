import { HTPR_7844_TEAM_AI_KEY_ONLY_FLAG } from "@/lib/flags/definitions/htpr-7844-team-ai-key-only";
import { decryptByokSecret } from "@/lib/crypto/byokCipher";
import { getAiProviderByByokKey, type TAiProviderKey, type TByokProviderKey } from "@/lib/aiProviders";
import prisma from "@/lib/prisma";

export const TEAM_KEY_ONLY_MESSAGE =
  "This team runs AI only on its own saved keys. This action has no saved key it can use, so Hypertask will not use a platform key.";

const PLATFORM_KEY_ENVS = [
  "AI_GATEWAY_API_KEY",
  "DEMO_AI_GATEWAY_API_KEY",
  "TURBOPUFFER_EMBEDDINGS_API_KEY",
  "DEEPGRAM_API_KEY",
] as const;

export class TeamKeyOnlyRefusal extends Error {
  readonly code = "team_ai_key_only";

  constructor(message = TEAM_KEY_ONLY_MESSAGE) {
    super(message);
    this.name = "TeamKeyOnlyRefusal";
  }
}

export type TeamAiFeature =
  | "chat"
  | "side-call"
  | "labels"
  | "images"
  | "embeddings"
  | "dictation"
  | "gateway";

export type TeamAiFundingRequest = {
  provider: string;
  feature: TeamAiFeature;
};

export type TeamAiFunding =
  | { mode: "unrestricted" }
  | { mode: "byok"; provider: string; apiKey: string }
  | { mode: "refused"; message: string };

export type TeamAiFundingSnapshot = {
  flagOn: boolean;
  aiKeyOnly: boolean;
  keys: Partial<Record<string, string>>;
};

export type KeyOnlyUsageRow = {
  feature: string;
  provider: string;
  apiKey: string;
  billing: "byok";
};

export const KEY_ONLY_AI_PATHS = [
  { feature: "chat", provider: "anthropic", label: "chat" },
  { feature: "side-call", provider: "google", label: "side-call" },
  { feature: "labels", provider: "google", label: "labels" },
  { feature: "images", provider: "gateway", label: "images" },
  { feature: "embeddings", provider: "openai", label: "embeddings" },
  { feature: "dictation", provider: "deepgram", label: "dictation" },
  { feature: "gateway", provider: "gateway", label: "gateway" },
] as const satisfies ReadonlyArray<{ feature: TeamAiFeature; provider: string; label: string }>;

export function isPlatformAiCredential(apiKey: string | null | undefined): boolean {
  const normalized = apiKey?.trim();
  if (!normalized) return false;
  return PLATFORM_KEY_ENVS.some((name) => {
    const value = process.env[name]?.trim();
    return Boolean(value) && value === normalized;
  });
}

function savedKey(keys: Partial<Record<string, string>>, provider: string): string | undefined {
  const aliases = provider === "anthropic" || provider === "claude"
    ? ["claude", "anthropic"]
    : provider === "embeddings" || provider === "openai"
      ? ["openai"]
      : [provider];
  for (const alias of aliases) {
    const value = keys[alias]?.trim();
    if (value && !isPlatformAiCredential(value)) return value;
  }
  return undefined;
}

function byok(provider: string, apiKey: string): TeamAiFunding {
  const normalized = provider === "anthropic" ? "claude" : provider;
  return { mode: "byok", provider: normalized, apiKey };
}

function refused(): TeamAiFunding {
  return { mode: "refused", message: TEAM_KEY_ONLY_MESSAGE };
}

function customerGatewayKey(keys: Partial<Record<string, string>>): string | undefined {
  for (const provider of ["gateway", "openai", "claude"]) {
    const value = keys[provider]?.trim();
    if (value && value.startsWith("vck_") && !isPlatformAiCredential(value)) return value;
  }
  return undefined;
}

export function decideTeamAiFunding(
  snapshot: TeamAiFundingSnapshot,
  request: TeamAiFundingRequest,
): TeamAiFunding {
  if (!snapshot.flagOn || !snapshot.aiKeyOnly) return { mode: "unrestricted" };
  if (request.feature === "dictation") return refused();
  if (request.feature === "images" || request.feature === "gateway") {
    const gateway = customerGatewayKey(snapshot.keys);
    return gateway ? byok("gateway", gateway) : refused();
  }
  if (request.feature === "embeddings") {
    const openai = savedKey(snapshot.keys, "openai");
    return openai ? byok("openai", openai) : refused();
  }
  if (request.provider === "gateway") {
    const gateway = customerGatewayKey(snapshot.keys);
    return gateway ? byok("gateway", gateway) : refused();
  }
  const direct = savedKey(snapshot.keys, request.provider);
  if (direct) return byok(request.provider, direct);
  if (request.feature === "labels" || request.feature === "side-call") {
    const claude = savedKey(snapshot.keys, "claude");
    if (claude) return byok("claude", claude);
  }
  return refused();
}

export function sideCallDecision(
  snapshot: TeamAiFundingSnapshot,
  requestedProvider: string,
): TeamAiFunding {
  return decideTeamAiFunding(snapshot, { provider: requestedProvider, feature: "side-call" });
}

export function runKeyOnlyAiPaths(snapshot: TeamAiFundingSnapshot): {
  usage: KeyOnlyUsageRow[];
  calls: string[];
  refusals: Array<{ feature: string; message: string }>;
} {
  const usage: KeyOnlyUsageRow[] = [];
  const calls: string[] = [];
  const refusals: Array<{ feature: string; message: string }> = [];
  for (const path of KEY_ONLY_AI_PATHS) {
    const decision = decideTeamAiFunding(snapshot, path);
    if (decision.mode === "byok") {
      usage.push({
        feature: path.label,
        provider: isPlatformAiCredential(decision.apiKey) ? "platform" : `byok:${decision.provider}`,
        apiKey: decision.apiKey,
        billing: "byok",
      });
      calls.push(decision.apiKey);
    } else if (decision.mode === "refused") {
      refusals.push({ feature: path.label, message: decision.message });
    } else {
      calls.push("PLATFORM_FALLBACK");
    }
  }
  return { usage, calls, refusals };
}

export function embeddingAuthorization(
  decision: TeamAiFunding,
  platformKey: string | undefined,
): { apiKey: string; endpoint: string; model: string } {
  if (decision.mode === "refused") throw new TeamKeyOnlyRefusal(decision.message);
  if (decision.mode === "byok") {
    return {
      apiKey: decision.apiKey,
      endpoint: "https://api.openai.com/v1/embeddings",
      model: "text-embedding-3-small",
    };
  }
  const apiKey = platformKey?.trim();
  if (!apiKey) throw new Error("TURBOPUFFER_EMBEDDINGS_API_KEY is not set");
  return {
    apiKey,
    endpoint: "https://ai-gateway.vercel.sh/v1/embeddings",
    model: "openai/text-embedding-3-small",
  };
}

export function dictationAuthorization(
  decision: TeamAiFunding,
  platformKey: string | undefined,
): string {
  if (decision.mode === "refused") throw new TeamKeyOnlyRefusal(decision.message);
  if (decision.mode === "byok") return decision.apiKey;
  const apiKey = platformKey?.trim();
  if (!apiKey) throw new Error("Deepgram API key not configured");
  return apiKey;
}

export function aiProvidersForSavedByokKeys(byokProviders: readonly string[]): TAiProviderKey[] {
  const providers: TAiProviderKey[] = [];
  for (const provider of byokProviders) {
    const match = getAiProviderByByokKey(provider as TByokProviderKey);
    if (match && !providers.includes(match.key)) providers.push(match.key);
  }
  return providers;
}

export function applyKeyOnlyProviderVisibility<T extends { key: string; enabled: boolean }>(
  rows: readonly T[],
  savedProviders: readonly string[],
  keyOnly: boolean,
): T[] {
  if (!keyOnly) return rows.map((row) => ({ ...row }));
  const saved = new Set(savedProviders);
  return rows.map((row) => ({ ...row, enabled: row.enabled && saved.has(row.key) }));
}

export function modelOptionsForKeyOnlyTeam<T extends { modelKey: string }>(
  options: readonly T[],
  savedProviders: readonly string[],
  definitionOf: (modelKey: string) => { provider?: string } | null | undefined,
): T[] {
  const saved = new Set(savedProviders);
  return options.filter((option) => {
    const provider = definitionOf(option.modelKey)?.provider;
    return Boolean(provider && provider !== "custom" && saved.has(provider));
  });
}

async function loadTeamAiFundingSnapshot(teamId: string): Promise<TeamAiFundingSnapshot | null> {
  if (!teamId) return null;
  let flagOn = false;
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    flagOn = await isFeatureEnabled(HTPR_7844_TEAM_AI_KEY_ONLY_FLAG, 0);
  } catch {
    return null;
  }
  if (!flagOn) return null;
  let team: {
    aiKeyOnly: boolean;
    byokApiKeys: Array<{ provider: string; ciphertext: string | null }>;
  } | null;
  try {
    team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        aiKeyOnly: true,
        byokApiKeys: {
          where: { enabled: true },
          select: { provider: true, ciphertext: true },
        },
      },
    });
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw new TeamKeyOnlyRefusal(TEAM_KEY_ONLY_MESSAGE);
  }
  if (!team?.aiKeyOnly) return null;
  const keys: Partial<Record<string, string>> = {};
  for (const row of team.byokApiKeys) {
    const ciphertext = row.ciphertext?.trim();
    if (!ciphertext) continue;
    try {
      const secret = decryptByokSecret(ciphertext)?.trim();
      if (secret && !isPlatformAiCredential(secret)) keys[row.provider] = secret;
    } catch {
      continue;
    }
  }
  return { flagOn: true, aiKeyOnly: true, keys };
}

export async function resolveTeamAiFunding(
  teamId: string,
  request: TeamAiFundingRequest,
): Promise<TeamAiFunding> {
  const snapshot = await loadTeamAiFundingSnapshot(teamId);
  if (!snapshot) return { mode: "unrestricted" };
  return decideTeamAiFunding(snapshot, request);
}

export async function resolveSideCallFunding(
  teamId: string,
  requestedProvider: string,
): Promise<TeamAiFunding> {
  const snapshot = await loadTeamAiFundingSnapshot(teamId);
  if (!snapshot) return { mode: "unrestricted" };
  return sideCallDecision(snapshot, requestedProvider);
}
