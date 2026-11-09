import {
  AUTO_MODEL_OPTION_ID,
  aiModelOptions,
  getAiModelDefinition,
  isAiModelOptionVisible,
  isPremiumAiModelDefinition,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";
import type { StorePlanKind } from "@/lib/planFromStripePriceId";
import { HTPR_7915_AUTO_MODEL_FLAG } from "@/lib/flags/definitions/htpr-7915-auto-model";
import { tierForFeature, type AutoTier } from "@/app/api/ai/_lib/reasoningEffort";

export { AUTO_MODEL_OPTION_ID, HTPR_7915_AUTO_MODEL_FLAG };

export const AUTO_LONG_THREAD_MESSAGES = 20;

export type AutoModelContext = {
  feature?: string | null;
  settings: unknown;
  plan?: StorePlanKind | null;
  byokProviderFlags?: ReadonlyArray<{ provider?: string | null; enabled?: boolean | null }> | null;
  grokGemini4Enabled?: boolean;
  planDefault?: TAiModelOption;
  stepUp?: number;
};

function byokSourceEnabled(flags: AutoModelContext["byokProviderFlags"], source: string): boolean {
  if (flags?.some((flag) => flag.provider === "gateway" && flag.enabled)) return true;
  return source !== "gateway" && Boolean(flags?.some((flag) => flag.provider === source && flag.enabled));
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
    if (context.plan === "BYOK" && !byokSourceEnabled(context.byokProviderFlags, option.source)) continue;
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
  const candidates = atOrBelow.length > 0 ? atOrBelow : pool;
  const wantedTier = atOrBelow.length > 0
    ? Math.max(...candidates.map(tierOf))
    : Math.min(...candidates.map(tierOf));
  const sameTier = candidates.filter((option) => tierOf(option) === wantedTier);
  return (
    sameTier.find((option) => getAiModelDefinition(option.modelKey)?.provider === preferredProvider) ??
    sameTier[0] ??
    null
  );
}

export function chatStepUp(input: {
  message: string;
  history: ReadonlyArray<{ content?: string; role?: string }> | null | undefined;
}): number {
  const history = input.history ?? [];
  const lastHuman = [...history].reverse().find((entry) => entry.role === "human" || entry.role === "user");
  const resent = lastHuman?.content?.trim() === input.message.trim();
  const longThread = history.length >= AUTO_LONG_THREAD_MESSAGES;
  const hasCode = input.message.includes("```");
  return (longThread ? 1 : 0) + (resent ? 1 : 0) + (hasCode ? 1 : 0);
}
