export type TRosterSortable = {
  id?: string;
  displayName: string;
  lastChatMessageAt?: string | null;
};

export function sortRosterByActivity<T extends TRosterSortable>(
  agents: readonly T[],
): T[] {
  return [...agents].sort((a, b) => {
    const at = a.lastChatMessageAt ?? "";
    const bt = b.lastChatMessageAt ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function bumpRosterChatRecency<T extends TRosterSortable>(
  agents: readonly T[] | null | undefined,
  agentId: string,
  lastChatMessageAt: string,
): T[] | null {
  if (!agents) return null;
  return agents.map((agent) =>
    agent.id === agentId ? { ...agent, lastChatMessageAt } : agent,
  );
}
