import prisma from "@/lib/prisma";
import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import { isInternalCompTeam } from "@/lib/internalCompTeams";
import { applyTeamComp } from "@/lib/teamComp";
import {
  pickEntitlingSubscriptionRow,
  subscriptionStatusGrantsAccess,
} from "@/lib/subscriptionAccess";
import { HTPR_7010_HAIKU_5_5_FLAG, HTPR_7038_HAIKU_DEFAULT_FLAG, HTPR_7075_BACKGROUND_CLAUDE_FLAG, HTPR_7076_PROMPT_CACHE_FLAG, LUNA_FREE_PLAN_FLAG } from "@/lib/flags/keys";
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

/** Resolves the current store plan from one already-loaded team row. */
export function storePlanIdForTeam(team: TeamPlanSource | null | undefined) {
  if (!team) return "Free" as const;
  if (isInternalCompTeam(team.id)) return "Pro" as const;
  const row = pickEntitlingSubscriptionRow(
    team.subscriptionPlan,
    team.activeSubscriptionPlanId,
  );
  // A dead subscription row keeps its priceId, so the status has to gate the
  // plan itself (HTPR-4863) — otherwise a failed card still resolves to Pro.
  const paidPlan =
    row && subscriptionStatusGrantsAccess(row.subscriptionStatus)
      ? planKindFromStripePriceId(row.priceId ?? null).storePlanId
      : ("Free" as const);
  // A comp (HTPR-6653) grants its plan, Pro when unset, unless the team pays for more.
  return applyTeamComp(team, paidPlan);
}

/** Server-side mirror of deriveCurrentBoardBilling's plan pick — trusts the DB, not the client payload. */
export async function storePlanIdForProject(
  projectId: number | null | undefined,
  teamId?: string | null
) {
  if (!projectId && !teamId) return "Free" as const;
  if (isInternalCompTeam(teamId)) return "Pro" as const;
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

/** Throws when a Free-plan (or teamless) request asks for a premium model. Free teams without any
 * team/project context are treated as Free, not exempted. */
/**
 * HTPR-6722: whether GPT 6 Luna is an included model for this user's Free plan.
 * Enforced on the server; fails closed when the flag cannot be read.
 */
export async function lunaFreePlanEnabled(
  userId: number | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  if (await haikuDefaultModelEnabled(userId)) return true;
  try {
    // Loaded on demand: @/lib/flags reaches the auth stack, which the many
    // callers that only need the plan checks below should not pay for.
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(LUNA_FREE_PLAN_FLAG, userId);
  } catch {
    return false;
  }
}

/**
 * HTPR-7075: background AI jobs run on Claude 5.5. Jobs with no user (demo board,
 * crons) evaluate the flag as user 0, which only an Everyone rollout enables.
 * A failed read counts as Off, so the old model ladders keep working.
 */
export async function backgroundClaudeModelEnabled(userId: number | null | undefined): Promise<boolean> {
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7075_BACKGROUND_CLAUDE_FLAG, userId ?? 0);
  } catch {
    return false;
  }
}

/** HTPR-7076: cache fixed AI instructions. Failed read counts as Off; no user evaluates as user 0. */
export async function promptCacheEnabled(userId: number | null | undefined): Promise<boolean> {
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7076_PROMPT_CACHE_FLAG, userId ?? 0);
  } catch {
    return false;
  }
}

export async function haikuDefaultModelEnabled(userId: number | null | undefined): Promise<boolean> {
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    if (await isFeatureEnabled(HTPR_7038_HAIKU_DEFAULT_FLAG, userId ?? 0)) return true;
  } catch {
    return backgroundClaudeModelEnabled?.(userId) ?? false;
  }
  return backgroundClaudeModelEnabled?.(userId) ?? false;
}

export async function haiku55ModelEnabled(userId: number | null | undefined): Promise<boolean> {
  if (await haikuDefaultModelEnabled(userId)) return true;
  if (!userId) return false;
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7010_HAIKU_5_5_FLAG, userId);
  } catch {
    return false;
  }
}

export async function assertModelAllowedForPlan(
  projectId: number | null | undefined,
  modelOption: TAiModelOption | undefined,
  teamId?: string | null,
  credential?: unknown,
  lunaFree = false,
) {
  if (
    !modelOption ||
    !isPremiumAiModelDefinition(getAiModelDefinition(modelOption.modelKey))
  ) {
    return;
  }
  // HTPR-6722: with the flag on, Luna is an included model on Free plans only.
  const lunaIncludedOnFree =
    lunaFree && modelOption.modelKey === LUNA_FREE_MODEL_KEY;
  const sharedKey = process.env.AI_GATEWAY_API_KEY?.trim();
  const resolvedCredential =
    typeof credential === "string" ? credential.trim() : credential;
  // Customer BYOK and platform-managed dedicated keys are already authorized
  // by the plan-aware key resolver. Only the shared platform key needs the
  // Free/BYOK premium-model gate here.
  if (
    (typeof resolvedCredential === "string" &&
      resolvedCredential.length > 0 &&
      resolvedCredential !== sharedKey) ||
    (resolvedCredential !== null && typeof resolvedCredential === "object")
  ) {
    return;
  }
  // Missing credentials fail closed in modelProvider with the more useful
  // dedicated-key error. A request with no team/project context is explicitly
  // Free, so retain the plan error instead of treating it as exempt.
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
