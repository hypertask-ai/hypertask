/**
 * The entry a newly created section gets inside every view's board_columns_view.
 *
 * Kept free of Prisma so the rule it encodes stays directly testable: a column
 * the user just created is visible in every view of the board (HTPR-5527).
 * Hiding a column is a separate, deliberate per-view action in Manage Columns.
 */
export type NewSectionForView = {
  id: number
  section_title: string
  // Optional because view entries saved before this field existed carry no
  // ranking; the canonical order lives on Section.ranking either way.
  ranking?: string
}

export const buildViewColumnEntry = (section: NewSectionForView) => ({
  ...section,
  title: section.section_title,
  visibility: true,
})
