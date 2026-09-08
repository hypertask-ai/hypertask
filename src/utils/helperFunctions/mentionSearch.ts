export const resolveMentionProjectId = (
  projectId: number | null | undefined,
  fallbackProjectId: string | null,
) => projectId ?? fallbackProjectId;

export const matchesMentionName = (displayName: string, query: string) =>
  displayName.toLowerCase().includes(query.toLowerCase());

type MentionAgentCandidate = {
  id: string;
  displayName: string;
};

const compareMentionAgents = (
  left: MentionAgentCandidate,
  right: MentionAgentCandidate,
) => {
  const leftName = left.displayName.toLowerCase();
  const rightName = right.displayName.toLowerCase();
  if (leftName !== rightName) return leftName < rightName ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
};

export const selectMentionAgents = <T extends MentionAgentCandidate>(
  agents: readonly T[],
  query: string,
) =>
  agents
    .filter(
      (agent) =>
        query === "all" || matchesMentionName(agent.displayName, query),
    )
    .toSorted(compareMentionAgents);
