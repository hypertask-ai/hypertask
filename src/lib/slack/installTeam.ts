export function slackConnectHref(teamId: string | null | undefined): string {
  const id = teamId?.trim();
  return id
    ? `/api/slack/install?teamId=${encodeURIComponent(id)}`
    : "/api/slack/install";
}

export async function resolveSlackInstallTeamId(
  userId: number,
  requestedTeamId: string | null | undefined,
  hasAccess: (userId: number, teamId: string) => Promise<boolean>,
  soleTeamId: (userId: number) => Promise<string | null>,
): Promise<string | null> {
  const requested = requestedTeamId?.trim() ?? "";
  if (requested) {
    return (await hasAccess(userId, requested)) ? requested : null;
  }
  return soleTeamId(userId);
}
