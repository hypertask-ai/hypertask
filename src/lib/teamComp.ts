import { STORE_PLAN_RANK, type StorePlanKind } from "@/lib/planFromStripePriceId";

export const TEAM_COMP_PLANS = ["Pro", "BYOK"] as const;
export type TeamCompPlan = (typeof TEAM_COMP_PLANS)[number];

export type TeamCompSource = {
  compedUntil?: Date | string | null;
  compedPlan?: string | null;
};

export function isTeamComped(
  team: { compedUntil?: Date | string | null } | null | undefined
): boolean {
  return Boolean(
    team?.compedUntil && new Date(team.compedUntil).getTime() > Date.now()
  );
}

export function teamCompPlan(
  team: TeamCompSource | null | undefined
): TeamCompPlan | null {
  if (!isTeamComped(team)) return null;
  return team?.compedPlan === "BYOK" ? "BYOK" : "Pro";
}

export function applyTeamComp(
  team: TeamCompSource | null | undefined,
  paidPlan: StorePlanKind
): StorePlanKind {
  const comp = teamCompPlan(team);
  if (!comp) return paidPlan;
  return STORE_PLAN_RANK[comp] >= STORE_PLAN_RANK[paidPlan] ? comp : paidPlan;
}
