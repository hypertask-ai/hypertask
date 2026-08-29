export type NewTaskSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type NewTaskUrlTarget = {
  boardId?: number;
  columnId?: number;
  columnTitle?: string;
};

export type NewTaskUrlSection = {
  id?: number;
  section_title: string;
};

const firstValue = (
  searchParams: NewTaskSearchParams,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = searchParams[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.trim()) return first.trim();
  }
  return undefined;
};

const positiveInteger = (value: string | undefined): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * Parse bookmark targets such as `/new?board=15&column=Bugs`.
 *
 * `id` remains supported because the composer already generates `/new?id=...`
 * links when a user switches boards from the full-screen composer.
 */
export const parseNewTaskUrlTarget = (
  searchParams: NewTaskSearchParams,
): NewTaskUrlTarget => {
  const boardValue = firstValue(searchParams, ["board"]);
  const legacyBoardValue = firstValue(searchParams, ["id"]);
  const columnValue = firstValue(searchParams, ["column"]);

  const boardId = positiveInteger(boardValue) ?? positiveInteger(legacyBoardValue);
  const columnId = positiveInteger(columnValue);

  return {
    boardId,
    columnId,
    columnTitle: columnId ? undefined : columnValue,
  };
};

export const findNewTaskUrlSection = (
  sections: readonly NewTaskUrlSection[] | undefined,
  target: Pick<NewTaskUrlTarget, "columnId" | "columnTitle">,
): NewTaskUrlSection | undefined => {
  if (!sections?.length) return undefined;

  if (target.columnId) {
    return sections.find((section) => section.id === target.columnId);
  }

  if (!target.columnTitle) return undefined;

  const requestedTitle = target.columnTitle.trim().toLowerCase();
  return sections.find(
    (section) => section.section_title.trim().toLowerCase() === requestedTitle,
  );
};
