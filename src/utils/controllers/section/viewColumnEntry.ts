/**
 * The entry a newly created section gets inside every view's board_columns_view.
 *
 * Kept free of Prisma so the rule it encodes stays directly testable: a column
 * the user just created is visible in every view of the board (HTPR-5527).
 * Hiding a column is a separate, deliberate per-view action in Manage Columns.
 */
/**
 * Deliberately narrow: only the three fields a view entry needs. Callers pass
 * a wider Section-shaped object, which is assignable without an index
 * signature, and dropping that signature is what lets the typed ISection from
 * the client share this function with the server.
 *
 * `ranking` is optional because view entries saved before that field existed
 * carry none; the canonical order lives on Section.ranking either way.
 */
export type NewSectionForView = {
  id: number
  section_title: string
  ranking?: string
}

export const buildViewColumnEntry = (section: NewSectionForView) => ({
  ...section,
  title: section.section_title,
  visibility: true,
})
