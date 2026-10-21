export const INTERNAL_COMP_TEAM_IDS = new Set<string>([
  "08f79efd-770e-4e32-9728-65e6d29ec893",
]);

export function isInternalCompTeam(
  teamId: string | null | undefined
): boolean {
  return !!teamId && INTERNAL_COMP_TEAM_IDS.has(teamId);
}
