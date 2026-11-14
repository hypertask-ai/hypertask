import { AUTO_MODEL_OPTION_ID, aiModelOptions, getAiModelDefinition, isAiModelOptionVisible, isPremiumAiModelDefinition, type TAiModelOption } from "@/lib/aiModelOptions";
import { isByokProviderKey, resolveTeamProviderEnabled, type TByokProviderKey } from "@/lib/aiProviders";
import { modelOptionMatchesForcedKey } from "@/lib/ai/forcedTeamKey";
import type { StorePlanKind } from "@/lib/planFromStripePriceId";
import { HTPR_7915_AUTO_MODEL_FLAG } from "@/lib/flags/definitions/htpr-7915-auto-model";
import { tierForFeature, type AutoTier } from "@/app/api/ai/_lib/reasoningEffort";

export const AUTO_LONG_THREAD_MESSAGES = 20;

export type AutoModelContext = {
  feature?: string | null;
  settings: unknown;
  plan?: StorePlanKind | null;
  byokProviderFlags?: ReadonlyArray<{ provider?: string | null; enabled?: boolean | null }> | null;
  grokGemini4Enabled?: boolean;
  planDefault?: TAiModelOption;
  stepUp?: number;
  forcedProvider?: TByokProviderKey | null;
};

function byokAllows(flags: AutoModelContext["byokProviderFlags"], option: TAiModelOption): boolean {
  return Boolean(
    flags?.some((flag) => flag.enabled && isByokProviderKey(flag.provider) && modelOptionMatchesForcedKey(option, flag.provider)),
  );
}

const EFFORT_RANK = { standard: 0, light: 1, high: 2 } as const;

export async function autoModelEnabled(userId: number | null | undefined): Promise<boolean> {
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) return false;
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7915_AUTO_MODEL_FLAG, userId);
  } catch {
    return false;
  }
}

export async function autoForcedProvider(lookup: unknown): Promise<TByokProviderKey | null> {
  const { resolveForcedTeamKey } = await import("@/app/api/ai/_lib/byokKeys");
  return resolveForcedTeamKey(lookup as Parameters<typeof resolveForcedTeamKey>[0]).then((forced) => forced?.provider ?? null, () => null);
}

export function isAutoRequest(modelOptionId: string | null | undefined): boolean {
  return modelOptionId?.trim() === AUTO_MODEL_OPTION_ID;
}

export function autoModelPool(context: AutoModelContext): TAiModelOption[] {
  const freePlan = context.plan === "Free";
  const byModelKey = new Map<string, TAiModelOption>();
  for (const option of aiModelOptions) {
    const definition = getAiModelDefinition(option.modelKey);
    if (!definition || definition.provider === "custom" || option.source === "custom") continue;
    if (!isAiModelOptionVisible(option, true, false, Boolean(context.grokGemini4Enabled))) continue;
    if (!resolveTeamProviderEnabled(context.settings, definition.provider)) continue;
    if (context.forcedProvider && !modelOptionMatchesForcedKey(option, context.forcedProvider)) continue;
    if (context.plan === "BYOK" && !byokAllows(context.byokProviderFlags, option)) continue;
    if (freePlan && isPremiumAiModelDefinition(definition, true)) continue;
    const rank = EFFORT_RANK[option.effort ?? "standard"];
    const held = byModelKey.get(option.modelKey);
    if (!held || rank < EFFORT_RANK[held.effort ?? "standard"]) byModelKey.set(option.modelKey, option);
  }
  return [...byModelKey.values()];
}

export function pickAutoModelOption(context: AutoModelContext): TAiModelOption | null {
  const pool = autoModelPool(context);
  const tierOf = (option: TAiModelOption) => getAiModelDefinition(option.modelKey)?.priceTier ?? 3;
  const target = Math.min(3, tierForFeature(context.feature) + (context.stepUp ?? 0)) as AutoTier;
  const preferredProvider = context.planDefault ? getAiModelDefinition(context.planDefault.modelKey)?.provider : undefined;
  const atOrBelow = pool.filter((option) => tierOf(option) <= target);
  const wantedTier = atOrBelow.length > 0 ? Math.max(...atOrBelow.map(tierOf)) : Math.min(...pool.map(tierOf));
  const sameTier = pool.filter((option) => tierOf(option) === wantedTier);
  return sameTier.find((option) => getAiModelDefinition(option.modelKey)?.provider === preferredProvider) ?? sameTier[0] ?? null;
}

export function chatStepUp(input: {
  message: string;
  history: ReadonlyArray<{ content?: string; role?: string }> | null | undefined;
}): number {
  const history = input.history ?? [];
  const lastHuman = [...history].reverse().find((entry) => entry.role === "human" || entry.role === "user");
  const resent = lastHuman?.content?.trim() === input.message.trim();
  return (history.length >= AUTO_LONG_THREAD_MESSAGES ? 1 : 0) + (resent ? 1 : 0) + (input.message.includes("```") ? 1 : 0);
}
