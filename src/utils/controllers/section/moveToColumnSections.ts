import type { ISection } from "@/models/model";

/**
 * The column list the "Move task to column" dialog shows (HTPR-6259).
 *
 * Kept free of Prisma so the rule it encodes stays directly testable: the board
 * default view names the columns, the active view only decides which of them
 * read as visible.
 *
 * `View.board_columns_view` is nullable, and several writers leave it null: a
 * view created without explicit columns, and smart-split copying a base view
 * that had none. Reading it as an array and calling `.find` on it threw, the
 * controller swallowed the throw into a 200, and the dialog rendered an empty
 * list — no columns, no error, nothing to click. Every one of those shapes now
 * degrades to "this view carries no column overrides" instead.
 */
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
  // The board default view names the columns. With no usable entry there, the
  // Section rows are the only remaining truth about what this board has.
  const base =
    stored && stored.length
      ? stored
      : boardSections.map((section) => ({ ...section, visibility: true }));

  const active = asColumns(activeColumns);
  // The default view IS the base, and a view with no stored columns overrides
  // nothing. Either way the base visibility already answers the question.
  if (activeViewType === "Default" || !active) return base;

  return base.map((section) => {
    const inActiveView = active.find((column) => column.id === section.id);
    return inActiveView
      ? { ...section, visibility: inActiveView.visibility }
      : { ...section, visibility: false };
  });
};
