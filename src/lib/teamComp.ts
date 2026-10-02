import { STORE_PLAN_RANK, type StorePlanKind } from "@/lib/planFromStripePriceId";

/** Plans an owner can comp a team onto (HTPR-6653). Mirrors the Prisma `TeamCompPlan` enum. */
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

/**
 * The plan an active comp grants, or null when the team is not comped.
 * A null compedPlan predates HTPR-6653 and means Pro.
 */
export function teamCompPlan(
  team: TeamCompSource | null | undefined
): TeamCompPlan | null {
  if (!isTeamComped(team)) return null;
  return team?.compedPlan === "BYOK" ? "BYOK" : "Pro";
}

/**
 * Effective plan when a comp and a paid subscription can both apply: the higher
 * of the two wins, so a BYOK comp never downgrades a team that pays for Pro.
 */
export function applyTeamComp(
  team: TeamCompSource | null | undefined,
  paidPlan: StorePlanKind
): StorePlanKind {
  const comp = teamCompPlan(team);
  if (!comp) return paidPlan;
  return STORE_PLAN_RANK[comp] >= STORE_PLAN_RANK[paidPlan] ? comp : paidPlan;
}
