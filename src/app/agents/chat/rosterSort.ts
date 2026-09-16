export type TRosterSortable = {
  id?: string;
  displayName: string;
  lastPostedAt?: string | null;
  lastChatMessageAt?: string | null;
};

/**
 * Newest-activity-first order for the Agent Chat roster (HTPR-6283).
 *
 * Flag off: unchanged from the pre-HTPR-6283 behavior -- last board post,
 * name tiebreak. Flag on: last real chat message only, so an agent that only
 * posted on a board (no chat activity) does not outrank one you actually
 * talked to; agents with no chat message sink to the bottom, name tiebreak.
 */
export function sortRosterByActivity<T extends TRosterSortable>(
  agents: readonly T[],
  liveSortEnabled: boolean,
): T[] {
  return [...agents].sort((a, b) => {
    const at = (liveSortEnabled ? a.lastChatMessageAt : a.lastPostedAt) ?? "";
    const bt = (liveSortEnabled ? b.lastChatMessageAt : b.lastPostedAt) ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Point one roster row at a new chat timestamp so the live-sort comparator
 * can re-rank without waiting for /api/agents/owned (HTPR-6283 QA fail:
 * send updated messages but left the left-hand list stale until reload).
 */
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
