import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import { isInternalCompTeam } from "@/lib/internalCompTeams";
import { isTeamComped } from "@/lib/teamComp";
import {
  pickEntitlingSubscriptionRow,
  subscriptionStatusGrantsAccess,
} from "@/lib/subscriptionAccess";
import type { CurrentBoardBilling } from "@/store";
import type { IProject, ITeam } from "@/models/model";

export type TeamBillingSnapshot = Omit<CurrentBoardBilling, "projectId">;

/** Builds a billing snapshot directly from a team, without requiring a loaded board. */
export function deriveTeamBilling(
  team: ITeam | null | undefined
): TeamBillingSnapshot | null {
  if (!team?.id) return null;

  const row = pickEntitlingSubscriptionRow(
    team.subscriptionPlan,
    team.activeSubscriptionPlanId,
  );
  const stripePriceId = row?.priceId ?? null;
  // A row that no longer entitles (unpaid, canceled, expired) still carries its
  // priceId, so gate on the status too (HTPR-4863).
  const entitled = subscriptionStatusGrantsAccess(row?.subscriptionStatus);
  const { storePlanId: paidStorePlanId, billingInterval } = isTeamComped(team)
    ? { storePlanId: "Pro" as const, billingInterval: null }
    : entitled
      ? planKindFromStripePriceId(stripePriceId)
      : { storePlanId: "Free" as const, billingInterval: null };
  // Internal/owner teams are comped to the top tier regardless of Stripe state.
  const storePlanId = isInternalCompTeam(team.id) ? "Pro" : paidStorePlanId;
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

/** Builds billing snapshot from the current board's `IProject` (team + Stripe price on subscription row). */
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
