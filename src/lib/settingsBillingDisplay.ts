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
  const compDrivesPlan = comp !== null && billing?.storePlanId === comp;
  const comped =
    compDrivesPlan ||
    (billing != null &&
      billing.storePlanId !== "Free" &&
      billing.billingInterval === null);
  return {
    billingCycle: comped
      ? COMPED_BILLING_CYCLE
      : billing?.billingInterval ?? "Free Plan",
    comped,
    compedUntil:
      compDrivesPlan && team?.compedUntil ? new Date(team.compedUntil) : null,
    plan: comped && comp ? comp : billing?.storePlanId ?? "Free",
  };
}
