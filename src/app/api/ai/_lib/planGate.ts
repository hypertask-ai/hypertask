import prisma from "@/lib/prisma";
import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import { applyTeamComp } from "@/lib/teamComp";
import {
  pickEntitlingSubscriptionRow,
  subscriptionStatusGrantsAccess,
} from "@/lib/subscriptionAccess";
import { HTPR_7075_BACKGROUND_CLAUDE_FLAG, HTPR_7076_PROMPT_CACHE_FLAG, HTPR_7098_BATCH_BACKGROUND_AI_FLAG } from "@/lib/flags/keys";
import {
  getAiModelDefinition,
  isPremiumAiModelDefinition,
  LUNA_FREE_MODEL_KEY,
  type TAiImageModelDefinition,
  type TAiModelOption,
} from "@/lib/aiModelOptions";

export class AiPlanAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiPlanAccessError";
  }
}

export type TeamPlanSource = {
  id?: string | null;
  activeSubscriptionPlanId?: string | null;
  compedUntil?: Date | string | null;
  compedPlan?: string | null;
  subscriptionPlan?: ReadonlyArray<{
    subscriptionId?: string | null;
    subscriptionStatus: string;
    priceId?: string | null;
  }> | null;
};

export function storePlanIdForTeam(team: TeamPlanSource | null | undefined) {
  if (!team) return "Free" as const;
  const row = pickEntitlingSubscriptionRow(
    team.subscriptionPlan,
    team.activeSubscriptionPlanId,
  );
  const paidPlan =
    row && subscriptionStatusGrantsAccess(row.subscriptionStatus)
      ? planKindFromStripePriceId(row.priceId ?? null).storePlanId
      : ("Free" as const);
  return applyTeamComp(team, paidPlan);
}

export async function storePlanIdForProject(
  projectId: number | null | undefined,
  teamId?: string | null
) {
  if (!projectId && !teamId) return "Free" as const;
  const team = projectId
    ? (
        await prisma.project.findUnique({
          where: { id: projectId },
          select: {
            team: {
              select: {
                id: true,
                activeSubscriptionPlanId: true,
                compedUntil: true,
                compedPlan: true,
                subscriptionPlan: {
                  select: {
                    subscriptionId: true,
                    subscriptionStatus: true,
                    priceId: true,
                  },
                },
              },
            },
          },
        })
      )?.team
    : await prisma.team.findUnique({
        where: { id: teamId! },
        select: {
          id: true,
          activeSubscriptionPlanId: true,
          compedUntil: true,
          compedPlan: true,
          subscriptionPlan: {
            select: {
              subscriptionId: true,
              subscriptionStatus: true,
              priceId: true,
            },
          },
        },
      });
  return storePlanIdForTeam(team);
}

export async function backgroundClaudeModelEnabled(userId: number | null | undefined): Promise<boolean> {
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7075_BACKGROUND_CLAUDE_FLAG, userId ?? 0);
  } catch {
    return false;
  }
}

export async function promptCacheEnabled(userId: number | null | undefined): Promise<boolean> {
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7076_PROMPT_CACHE_FLAG, userId ?? 0);
  } catch {
    return false;
  }
}

export async function batchBackgroundAiEnabled(userId: number | null | undefined): Promise<boolean> {
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7098_BATCH_BACKGROUND_AI_FLAG, userId ?? 0);
  } catch {
    return false;
  }
}

export async function haiku55ModelEnabled(_userId?: number | null): Promise<boolean> {
  return true;
}

export async function assertModelAllowedForPlan(
  projectId: number | null | undefined,
  modelOption: TAiModelOption | undefined,
  teamId?: string | null,
  credential?: unknown,
) {
  if (
    !modelOption ||
    !isPremiumAiModelDefinition(getAiModelDefinition(modelOption.modelKey))
  ) {
    return;
  }
  const lunaIncludedOnFree = modelOption.modelKey === LUNA_FREE_MODEL_KEY;
  const sharedKey = process.env.AI_GATEWAY_API_KEY?.trim();
  const resolvedCredential =
    typeof credential === "string" ? credential.trim() : credential;
  if (
    (typeof resolvedCredential === "string" &&
      resolvedCredential.length > 0 &&
      resolvedCredential !== sharedKey) ||
    (resolvedCredential !== null && typeof resolvedCredential === "object")
  ) {
    return;
  }
  if (!resolvedCredential) {
    if (!projectId && !teamId) {
      if (lunaIncludedOnFree) return;
      throw new AiPlanAccessError(
        "This model needs a paid plan or your own API key."
      );
    }
    return;
  }

  const storePlanId = await storePlanIdForProject(projectId, teamId);
  if (storePlanId === "Free") {
    if (lunaIncludedOnFree) return;
    throw new AiPlanAccessError(
      "This model needs a paid plan or your own API key."
    );
  }
  if (storePlanId === "BYOK") {
    throw new AiPlanAccessError("This model needs your own AI key.");
  }
}

export async function assertImageModelAllowedForPlan(
  projectId: number | null | undefined,
  model: TAiImageModelDefinition,
  credential?: unknown,
) {
  if (!model.premium) return;
  const sharedKey = process.env.AI_GATEWAY_API_KEY?.trim();
  const resolvedCredential =
    typeof credential === "string" ? credential.trim() : credential;
  if (
    typeof resolvedCredential === "string" &&
    resolvedCredential.length > 0 &&
    resolvedCredential !== sharedKey
  ) {
    return;
  }
  if (!resolvedCredential) return;
  const storePlanId = await storePlanIdForProject(projectId);
  if (storePlanId === "Free") {
    throw new Error("Image generation needs a paid plan.");
  }
  if (storePlanId === "BYOK") {
    throw new Error("Image generation needs your own AI key.");
  }
}
