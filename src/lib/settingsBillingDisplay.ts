import type { TeamBillingSnapshot } from "@/lib/deriveCurrentBoardBilling";
import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import {
  pickEntitlingSubscriptionRow,
  subscriptionStatusGrantsAccess,
} from "@/lib/subscriptionAccess";
import { applyTeamComp, teamCompPlan } from "@/lib/teamComp";
import type { ITeam } from "@/models/model";

export const COMPED_BILLING_CYCLE = "Comped";

export type SettingsBillingDisplay = {
  billingCycle: string;
  comped: boolean;
  compedUntil: Date | null;
  plan: string;
};

export function legacyBillingDisplay(
  billing: TeamBillingSnapshot | null | undefined
): SettingsBillingDisplay {
  return {
    billingCycle: billing?.billingInterval ?? "Free Plan",
    comped: false,
    compedUntil: null,
    plan: billing?.storePlanId ?? "Free",
  };
}

export function settingsBillingDisplay(
  team: ITeam | null | undefined,
  billing: TeamBillingSnapshot | null | undefined
): SettingsBillingDisplay {
  const comp = teamCompPlan(team);
  const row = pickEntitlingSubscriptionRow(
    team?.subscriptionPlan,
    team?.activeSubscriptionPlanId
  );
  const paid = subscriptionStatusGrantsAccess(row?.subscriptionStatus)
    ? planKindFromStripePriceId(row?.priceId)
    : null;
  const paidPlan = paid?.storePlanId ?? "Free";
  const compLoses = applyTeamComp(team, paidPlan) === paidPlan;
  const plan = billing?.storePlanId ?? applyTeamComp(team, paidPlan);
  const billedInterval = billing
    ? billing.billingInterval
    : compLoses
      ? paid?.billingInterval ?? null
      : null;
  const comped = plan !== "Free" && billedInterval === null;
  return {
    billingCycle: comped
      ? COMPED_BILLING_CYCLE
      : billedInterval ?? "Free Plan",
    comped,
    compedUntil:
      comped && comp && team?.compedUntil ? new Date(team.compedUntil) : null,
    plan,
  };
}
