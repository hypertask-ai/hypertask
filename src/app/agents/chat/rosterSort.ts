export type TRosterSortable = {
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
