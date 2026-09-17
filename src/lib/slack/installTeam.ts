export type SlackInstallTeamAccess = {
  firstTeamId: (userId: number) => Promise<string | null>;
  hasAccess: (userId: number, teamId: string) => Promise<boolean>;
};

export function slackConnectHref(teamId: string | null | undefined): string {
  const id = teamId?.trim();
  return id
    ? `/api/slack/install?teamId=${encodeURIComponent(id)}`
    : "/api/slack/install";
}

export async function resolveSlackInstallTeamId(
  userId: number,
  requestedTeamId: string | null | undefined,
  access: SlackInstallTeamAccess,
): Promise<string | null> {
  const requested = requestedTeamId?.trim() ?? "";
  if (requested) {
    return (await access.hasAccess(userId, requested)) ? requested : null;
  }
  return access.firstTeamId(userId);
}
