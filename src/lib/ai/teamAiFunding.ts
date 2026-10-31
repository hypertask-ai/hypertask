import { decryptByokSecret } from "@/lib/crypto/byokCipher";
import { getAiProviderByByokKey, resolveTeamProviderEnabled, type TAiProviderKey, type TByokProviderKey } from "@/lib/aiProviders";
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
  aiKeyOnlyPlatformServices?: boolean;
  keys: Partial<Record<string, string>>;
  anthropicEnabled?: boolean;
};

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

function anthropicKey(keys: Partial<Record<string, string>>): string | undefined {
  const value = savedKey(keys, "claude");
  if (!value || value.startsWith("vck_")) return undefined;
  return value;
}

export function decideTeamAiFunding(
  snapshot: TeamAiFundingSnapshot,
  request: TeamAiFundingRequest,
): TeamAiFunding {
  if (!snapshot.aiKeyOnly) return { mode: "unrestricted" };
  if (!snapshot.flagOn) return refused();
  if ((request.feature === "embeddings" || request.feature === "dictation") && snapshot.aiKeyOnlyPlatformServices === true) {
    return { mode: "unrestricted" };
  }
  if (
    request.feature === "dictation" ||
    request.feature === "images" ||
    request.feature === "embeddings" ||
    request.feature === "gateway"
  ) {
    return refused();
  }
  const claude = snapshot.anthropicEnabled === false ? undefined : anthropicKey(snapshot.keys);
  const anthropicRequest = request.provider === "anthropic" || request.provider === "claude";
  if (request.feature === "labels" || request.feature === "side-call" || anthropicRequest) {
    return claude ? byok("claude", claude) : refused();
  }
  return refused();
}

export function keyOnlyReplacementModelKey(
  decision: TeamAiFunding,
  provider: string | null | undefined,
  haiku55Enabled: boolean,
): "claude-haiku-5-5" | "claude-haiku-4.5" | null {
  if (decision.mode !== "byok" || decision.provider !== "claude") return null;
  if (provider === "claude" || provider === "anthropic") return null;
  return haiku55Enabled ? "claude-haiku-5-5" : "claude-haiku-4.5";
}

export function sideCallDecision(
  snapshot: TeamAiFundingSnapshot,
  requestedProvider: string,
): TeamAiFunding {
  return decideTeamAiFunding(snapshot, { provider: requestedProvider, feature: "side-call" });
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
  return rows.map((row) => ({
    ...row,
    enabled: row.key === "anthropic" && row.enabled && saved.has("anthropic"),
  }));
}

export function modelOptionsForKeyOnlyTeam<T extends { modelKey: string }>(
  options: readonly T[],
  savedProviders: readonly string[],
  definitionOf: (modelKey: string) => { provider?: string } | null | undefined,
): T[] {
  if (!savedProviders.includes("anthropic")) return [];
  return options.filter((option) => definitionOf(option.modelKey)?.provider === "anthropic");
}

async function loadTeamAiFundingSnapshot(teamId: string): Promise<TeamAiFundingSnapshot | null> {
  if (!teamId) throw new TeamKeyOnlyRefusal();
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      aiKeyOnly: true,
      aiKeyOnlyPlatformServices: true,
      aiProviderSettings: true,
      googleAccount: { select: { userId: true } },
    },
  });
  if (!team) throw new TeamKeyOnlyRefusal();
  if (team.aiKeyOnly === false) return null;
  if (team.aiKeyOnly !== true) throw new TeamKeyOnlyRefusal();
  if (!Number.isSafeInteger(team.googleAccount?.userId) || team.googleAccount.userId <= 0) {
    throw new TeamKeyOnlyRefusal();
  }
  const { isFeatureEnabled } = await import("@/lib/flags");
  const flagOn = await isFeatureEnabled("htpr-7844-team-ai-key-only", team.googleAccount.userId);
  if (flagOn !== true) return { flagOn: false, aiKeyOnly: true, keys: {} };
  const rows = await prisma.teamByokApiKey.findMany({
    where: { teamId, enabled: true },
    select: { provider: true, ciphertext: true },
  });
  const keys: Partial<Record<string, string>> = {};
  for (const row of rows) {
    const ciphertext = row.ciphertext?.trim();
    if (!ciphertext) continue;
    try {
      const secret = decryptByokSecret(ciphertext)?.trim();
      if (secret && !isPlatformAiCredential(secret)) keys[row.provider] = secret;
    } catch {
      continue;
    }
  }
  return { flagOn: true, aiKeyOnly: true, aiKeyOnlyPlatformServices: team.aiKeyOnlyPlatformServices === true, keys, anthropicEnabled: resolveTeamProviderEnabled(team.aiProviderSettings, "anthropic") };
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
