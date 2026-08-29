export function isTeamComped(
  team: { compedUntil?: Date | string | null } | null | undefined
): boolean {
  return Boolean(
    team?.compedUntil && new Date(team.compedUntil).getTime() > Date.now()
  );
}
