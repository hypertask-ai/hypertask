import type { ISection } from "@/models/model";

type ColumnEntry = ISection & { visibility?: boolean };

const asColumns = (value: unknown): ColumnEntry[] | null =>
  Array.isArray(value) ? (value as ColumnEntry[]) : null;

export const resolveMoveToColumnSections = ({
  defaultColumns,
  activeColumns,
  activeViewType,
  boardSections,
}: {
  defaultColumns: unknown;
  activeColumns: unknown;
  activeViewType: string | undefined;
  boardSections: ColumnEntry[];
}): ColumnEntry[] => {
  const stored = asColumns(defaultColumns);
  const base =
    stored && stored.length
      ? stored
      : boardSections.map((section) => ({ ...section, visibility: true }));

  const active = asColumns(activeColumns);
  if (activeViewType === "Default" || !active) return base;

  return base.map((section) => {
    const inActiveView = active.find((column) => column.id === section.id);
    return inActiveView
      ? { ...section, visibility: inActiveView.visibility }
      : { ...section, visibility: false };
  });
};
