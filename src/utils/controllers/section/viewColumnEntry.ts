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
