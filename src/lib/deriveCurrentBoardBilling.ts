import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import { isInternalCompTeam } from "@/lib/internalCompTeams";
import { teamCompPlan, applyTeamComp } from "@/lib/teamComp";
import {
  pickEntitlingSubscriptionRow,
  subscriptionStatusGrantsAccess,
} from "@/lib/subscriptionAccess";
import type { CurrentBoardBilling } from "@/store";
import type { IProject, ITeam } from "@/models/model";

export type TeamBillingSnapshot = Omit<CurrentBoardBilling, "projectId">;

export function deriveTeamBilling(
  team: ITeam | null | undefined,
  savedPlanOnly = false,
): TeamBillingSnapshot | null {
  if (!team?.id) return null;

  const row = pickEntitlingSubscriptionRow(
    team.subscriptionPlan,
    team.activeSubscriptionPlanId,
  );
  const stripePriceId = row?.priceId ?? null;
  const entitled = subscriptionStatusGrantsAccess(row?.subscriptionStatus);
  const paid = entitled
    ? planKindFromStripePriceId(stripePriceId)
    : { storePlanId: "Free" as const, billingInterval: null };
  const comp = teamCompPlan(team);
  const paidStorePlanId = applyTeamComp(team, paid.storePlanId);
  const billingInterval =
    comp && paidStorePlanId === comp ? null : paid.billingInterval;
  const storePlanId =
    !savedPlanOnly && isInternalCompTeam(team.id) ? "Pro" : paidStorePlanId;
  const byokProviderFlags =
    team.byokApiKeys?.map(({ enabled, provider }) => ({
      enabled,
      provider,
    })) ?? [];

  return {
    teamId: team.id,
    stripePriceId,
    storePlanId,
    billingInterval,
    byokProviderFlags,
  };
}

export function deriveCurrentBoardBilling(
  project: IProject | null,
  savedPlanOnly = false,
): CurrentBoardBilling | null {
  if (!project?.id) return null;

  const team: ITeam | undefined = project.team;
  const teamId = project.teamId ?? team?.id ?? null;
  const billing = deriveTeamBilling(team, savedPlanOnly);

  if (!billing) return null;

  return {
    projectId: project.id,
    ...billing,
    teamId,
  };
}
