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
 *
 * ponytail: that optionality also lets a future caller write a stored entry
 * with no ranking, which updateSectionInAllViews would then sort as equal to
 * every other entry. Every caller today passes a real ranking. If one stops,
 * give the read path its own looser type and make this one required again.
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
