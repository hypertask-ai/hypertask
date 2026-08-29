// Owner/internal teams comped to full model access without a paid Stripe plan.
// Kept as a code allowlist rather than a $0 Stripe subscription so revenue
// analytics stay honest (these teams are still $0 in Stripe) while they get
// every model. Inference is funded by the team's own provisioned gateway key.
// HTPR-4534.
export const INTERNAL_COMP_TEAM_IDS = new Set<string>([
  "08f79efd-770e-4e32-9728-65e6d29ec893", // Hypertask Product (owner team)
]);

export function isInternalCompTeam(
  teamId: string | null | undefined
): boolean {
  return !!teamId && INTERNAL_COMP_TEAM_IDS.has(teamId);
}
