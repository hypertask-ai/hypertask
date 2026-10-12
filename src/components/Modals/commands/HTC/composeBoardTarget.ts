export function resolveComposeBoardTarget({
  url,
  focusedTicketBoardId,
  lastUsedBoardId,
  destinationBoardId,
  selectedBoardId,
}: {
  url: string;
  focusedTicketBoardId?: number | null;
  lastUsedBoardId?: number;
  destinationBoardId?: number;
  selectedBoardId?: number;
}): { boardId: number | undefined; showChip: boolean } {
  const location = new URL(url, "https://hypertask.local");
  const validId = (value: string | number | null | undefined) => {
    if (value == null || !/^\d+$/.test(String(value))) return undefined;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  };
  const ticketBoard = location.pathname.match(/^\/detail\/project-(\d+)\/\d+$/)?.[1];
  const onBoard = /^\/project(?:\/|$)/.test(location.pathname);
  const contextualBoardId = validId(ticketBoard ?? (onBoard
    ? location.searchParams.get("id") ?? location.pathname.match(/^\/project\/(?:project-)?(\d+)/)?.[1]
    : undefined));
  let inboxBoardId: number | undefined;
  if (/^\/inbox(?:\/|$)/.test(location.pathname)) {
    const split = location.searchParams.get("split")?.toLowerCase();
    const splitBoardId = split === "all" || split === "important"
      ? undefined : validId(location.searchParams.get("projectId"));
    inboxBoardId = validId(focusedTicketBoardId) ?? splitBoardId;
  }
  const boardId = validId(selectedBoardId) ?? validId(destinationBoardId) ?? contextualBoardId ?? inboxBoardId ?? validId(lastUsedBoardId);
  return { boardId, showChip: validId(selectedBoardId) !== undefined || !contextualBoardId || boardId !== contextualBoardId };
}
