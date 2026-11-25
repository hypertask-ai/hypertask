import type { TeamBillingSnapshot } from "@/lib/deriveCurrentBoardBilling";
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
  return {
    billingCycle: comp
      ? COMPED_BILLING_CYCLE
      : billing?.billingInterval ?? "Free Plan",
    comped: comp !== null,
    compedUntil: comp && team?.compedUntil ? new Date(team.compedUntil) : null,
    plan: comp ?? billing?.storePlanId ?? "Free",
  };
}
