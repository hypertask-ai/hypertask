import type { TSectionPayload } from "../../../../models/CreateTaskModalModels/model";

export type TableSectionIdentifier = number | string;

export type TableCreateTaskSection = {
  sectionId?: TableSectionIdentifier | null;
  id?: TableSectionIdentifier | null;
  section_title: string;
};

export type TableCreateTaskRow = {
  sid?: string | number | null;
};

export type ToggleCreateTaskGlobally = (payload?: TSectionPayload) => void;

const toSafeNumericSectionId = (
  value: TableSectionIdentifier | null | undefined,
): number | undefined => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const isCanonicalNumericString = (value: string) =>
  value === "0" || /^[1-9]\d*$/.test(value);

export const tableSectionId = (
  section: TableCreateTaskSection,
): TableSectionIdentifier | undefined => {
  const id = section.sectionId ?? section.id;
  return typeof id === "number" || typeof id === "string" ? id : undefined;
};

export const tableSectionNumber = (
  section: TableCreateTaskSection,
): number | undefined => {
  return toSafeNumericSectionId(tableSectionId(section));
};

export const tableSectionKey = (
  section: TableCreateTaskSection,
): TableSectionIdentifier | undefined => {
  const id = tableSectionId(section);
  if (typeof id === "string" && !isCanonicalNumericString(id)) return id;
  return tableSectionNumber(section) ?? id;
};

export const resolveTableCreateTaskSectionPayload = (
  selectedSectionId: string | number | null | undefined,
  sections: readonly TableCreateTaskSection[],
): TSectionPayload | undefined => {
  const normalizedId = toSafeNumericSectionId(selectedSectionId);
  if (normalizedId === undefined) return undefined;
  const section = sections.find(
    (candidate) => tableSectionId(candidate) === selectedSectionId,
  ) ?? sections.find((candidate) => {
    const candidateId = tableSectionId(candidate);
    if (typeof selectedSectionId === "string" && !isCanonicalNumericString(selectedSectionId)) {
      return false;
    }
    if (typeof candidateId === "string" && !isCanonicalNumericString(candidateId)) {
      return false;
    }
    return tableSectionNumber(candidate) === normalizedId;
  });
  if (!section) return undefined;
  return {
    sectionId: normalizedId,
    sectionTitle: section.section_title,
    position: "bottom",
  };
};

export const createTaskFromTableSelection = ({
  hasCurrentProject,
  selectedRow,
  sections,
  toggleCreateTaskGlobally,
}: {
  hasCurrentProject: boolean;
  selectedRow?: TableCreateTaskRow;
  sections: readonly TableCreateTaskSection[];
  toggleCreateTaskGlobally: ToggleCreateTaskGlobally;
}) => {
  if (!hasCurrentProject) return;
  const payload = resolveTableCreateTaskSectionPayload(selectedRow?.sid, sections);
  if (!payload) return;
  toggleCreateTaskGlobally(payload);
};

export const getTableCreateTaskButtonLabels = (hasSelectedSection: boolean) =>
  hasSelectedSection
    ? {
        ariaLabel: "Create task in the selected column",
        title: "Create task in the selected column (C)",
      }
    : {
        ariaLabel: "Create task",
        title: "Create task (C)",
      };

export const getTableCreateTaskButtonLabelsForSelection = (
  selectedRow: TableCreateTaskRow | undefined,
  sections: readonly TableCreateTaskSection[],
) =>
  getTableCreateTaskButtonLabels(
    Boolean(resolveTableCreateTaskSectionPayload(selectedRow?.sid, sections)),
  );
