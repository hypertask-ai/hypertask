const cleanTitlePart = (value: string | null | undefined) => value?.trim() || null;

export const buildBoardDocumentTitle = (
  boardTitle: string,
  viewTitle?: string | null,
) => {
  const board = cleanTitlePart(boardTitle) ?? "Hypertask";
  const view = cleanTitlePart(viewTitle);
  return view
    ? `${view} • ${board} • Hypertask`
    : `${board} • Hypertask`;
};
