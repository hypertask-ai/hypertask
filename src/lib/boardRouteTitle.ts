type SearchParamValue = string | string[] | undefined;

export type BoardRouteSearchParams = Record<string, SearchParamValue>;

const cleanTitlePart = (value: string | null | undefined) =>
  value?.trim() || null;

const firstSearchParam = (value: SearchParamValue) =>
  Array.isArray(value) ? value[0] : value;

const positiveIntegerString = (value: string | null | undefined) => {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
};

export const buildBoardRouteTitle = (
  boardTitle: string | null | undefined,
  viewTitle?: string | null,
) => {
  const board = cleanTitlePart(boardTitle) ?? "Hypertask";
  const view = cleanTitlePart(viewTitle);
  return view
    ? `${view} • ${board} • Hypertask`
    : `${board} • Hypertask`;
};

export const resolveBoardRouteTitleRequest = (
  searchParams: BoardRouteSearchParams,
  previousBoardCookie?: string | null,
) => {
  const requestedProjectId = positiveIntegerString(
    firstSearchParam(searchParams.id),
  );
  const previousProjectId = positiveIntegerString(
    previousBoardCookie?.split("|&|")[0]?.replace(/^project-/, ""),
  );
  const rawViewSlug = firstSearchParam(searchParams.view)?.trim();

  return {
    projectId: requestedProjectId ?? previousProjectId,
    viewSlug: rawViewSlug && rawViewSlug !== "default" ? rawViewSlug : null,
  };
};
