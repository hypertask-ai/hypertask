export const resolveMentionProjectId = (
  projectId: number | null | undefined,
  fallbackProjectId: string | null,
) => projectId ?? fallbackProjectId;

export const matchesMentionName = (displayName: string, query: string) =>
  displayName.toLowerCase().includes(query.toLowerCase());
