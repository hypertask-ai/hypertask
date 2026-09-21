import prisma from "@/lib/prisma";
import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import { isInternalCompTeam } from "@/lib/internalCompTeams";
import { isTeamComped } from "@/lib/teamComp";
import {
  pickEntitlingSubscriptionRow,
  subscriptionStatusGrantsAccess,
} from "@/lib/subscriptionAccess";
import {
  getAiModelDefinition,
  isPremiumAiModelDefinition,
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
  subscriptionPlan?: ReadonlyArray<{
    subscriptionId?: string | null;
    subscriptionStatus: string;
    priceId?: string | null;
  }> | null;
};

/** Resolves the current store plan from one already-loaded team row. */
export function storePlanIdForTeam(team: TeamPlanSource | null | undefined) {
  if (!team) return "Free" as const;
  if (isInternalCompTeam(team.id) || isTeamComped(team)) return "Pro" as const;
  const row = pickEntitlingSubscriptionRow(
    team.subscriptionPlan,
    team.activeSubscriptionPlanId,
  );
  // A dead subscription row keeps its priceId, so the status has to gate the
  // plan itself (HTPR-4863) — otherwise a failed card still resolves to Pro.
  if (!row || !subscriptionStatusGrantsAccess(row.subscriptionStatus)) {
    return "Free" as const;
  }
  return planKindFromStripePriceId(row.priceId ?? null).storePlanId;
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
      throw new AiPlanAccessError(
        "This model needs a paid plan or your own API key."
      );
    }
    return;
  }

  const storePlanId = await storePlanIdForProject(projectId, teamId);
  if (storePlanId === "Free") {
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
