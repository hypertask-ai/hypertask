import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import { teamCompPlan, applyTeamComp } from "@/lib/teamComp";
import {
  pickEntitlingSubscriptionRow,
  subscriptionStatusGrantsAccess,
} from "@/lib/subscriptionAccess";
import type { CurrentBoardBilling } from "@/store";
import type { IProject, ITeam } from "@/models/model";

export type TeamBillingSnapshot = Omit<CurrentBoardBilling, "projectId">;

export function deriveTeamBilling(
  team: ITeam | null | undefined
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
  const storePlanId = applyTeamComp(team, paid.storePlanId);
  const billingInterval =
    comp && storePlanId === comp ? null : paid.billingInterval;
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
  project: IProject | null
): CurrentBoardBilling | null {
  if (!project?.id) return null;

  const team: ITeam | undefined = project.team;
  const teamId = project.teamId ?? team?.id ?? null;
  const billing = deriveTeamBilling(team);

  if (!billing) return null;

  return {
    projectId: project.id,
    ...billing,
    teamId,
  };
}
