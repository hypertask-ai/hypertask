import type { TeamBillingSnapshot } from "@/lib/deriveCurrentBoardBilling";
import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import {
  pickEntitlingSubscriptionRow,
  subscriptionStatusGrantsAccess,
} from "@/lib/subscriptionAccess";
import { teamCompPlan } from "@/lib/teamComp";
import type { ITeam } from "@/models/model";

export const COMPED_BILLING_CYCLE = "Comped";

export type SettingsBillingDisplay = {
  billingCycle: string;
  comped: boolean;
  compedUntil: Date | null;
  plan: string;
};

export function settingsBillingDisplay(
  team: ITeam | null | undefined,
  billing: TeamBillingSnapshot | null | undefined
): SettingsBillingDisplay {
  const comp = teamCompPlan(team);
  const paid = pickEntitlingSubscriptionRow(
    team?.subscriptionPlan,
    team?.activeSubscriptionPlanId
  );
  const paidRow = subscriptionStatusGrantsAccess(paid?.subscriptionStatus)
    ? paid
    : null;
  const comped = comp !== null && paidRow === null;
  return {
    billingCycle: comped
      ? COMPED_BILLING_CYCLE
      : billing?.billingInterval ??
        planKindFromStripePriceId(paidRow?.priceId).billingInterval ??
        "Free Plan",
    comped,
    compedUntil:
      comped && team?.compedUntil ? new Date(team.compedUntil) : null,
    plan: comped ? comp : billing?.storePlanId ?? "Free",
  };
}
