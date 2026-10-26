import type { Label, Prisma } from "@prisma/client";

type ProjectLabel = Pick<Label, "id" | "value">;

type ProjectLabelView = {
  id: string;
  title?: string | null;
  visibility?: string;
  board_filters?: unknown;
  unsaved_User_Project_View?: ReadonlyArray<{ id: string }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const matchesProjectLabelFilters = (
  boardFilters: unknown,
  labelId: string
): boolean => {
  if (!isRecord(boardFilters) || boardFilters.matchFilters !== "ALL") return false;
  if (!Array.isArray(boardFilters.addedFilters) || boardFilters.addedFilters.length !== 1) {
    return false;
  }
  const filter: unknown = boardFilters.addedFilters[0];
  if (!isRecord(filter) || filter.type !== "Labels" || filter.match !== "ANY") return false;
  if (!Array.isArray(filter.searchPayload) || filter.searchPayload.length !== 1) return false;
  const payload: unknown = filter.searchPayload[0];
  return isRecord(payload) && payload.id === labelId;
};

export const isProjectLabelView = (
  view: ProjectLabelView,
  label: ProjectLabel
): boolean =>
  view.visibility === "Public" &&
  !view.unsaved_User_Project_View?.length &&
  (view.id === label.id || view.title === label.value) &&
  matchesProjectLabelFilters(view.board_filters, label.id);

export const getProjectLabelView = <T extends ProjectLabelView>(
  views: ReadonlyArray<T>,
  label: ProjectLabel
): T | undefined =>
  views.find((view) => view.id === label.id && isProjectLabelView(view, label)) ??
  views.find((view) => isProjectLabelView(view, label));

export const replaceProjectLabelInBoardFilters = (
  boardFilters: Prisma.JsonValue,
  sourceId: string,
  target: ProjectLabel
): Prisma.JsonValue => {
  if (!isRecord(boardFilters) || !Array.isArray(boardFilters.addedFilters)) return boardFilters;
  let changed = false;
  const addedFilters = boardFilters.addedFilters.map((filter: Prisma.JsonValue) => {
    if (!isRecord(filter) || filter.type !== "Labels" || !Array.isArray(filter.searchPayload)) {
      return filter;
    }
    const payloads: Prisma.JsonArray = filter.searchPayload;
    if (!payloads.some((item) => isRecord(item) && item.id === sourceId)) return filter;
    let seenTarget = false;
    const searchPayload = payloads.flatMap((item) => {
      if (!isRecord(item) || (item.id !== sourceId && item.id !== target.id)) return [item];
      if (seenTarget) {
        changed = true;
        return [];
      }
      seenTarget = true;
      if (item.id === target.id && item.value === target.value) return [item];
      changed = true;
      return [{ ...item, id: target.id, value: target.value }];
    });
    return changed ? { ...filter, searchPayload } : filter;
  });
  return changed ? { ...boardFilters, addedFilters } : boardFilters;
};
