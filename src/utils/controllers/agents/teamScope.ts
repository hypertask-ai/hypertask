export const canAttachAgentToTeam = (
  memberTeamIds: Array<string | null>,
  targetTeamId: string,
) =>
  memberTeamIds.every(
    (memberTeamId) => memberTeamId == null || memberTeamId === targetTeamId,
  );

export const getAgentTeamId = (memberTeamIds: Array<string | null>) =>
  memberTeamIds.find((memberTeamId): memberTeamId is string =>
    Boolean(memberTeamId),
  ) ?? null;
