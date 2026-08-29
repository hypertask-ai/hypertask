export interface CreateSectionBody {
  project_id: number
  title: string
  after_section_id?: number
}

export interface CreateSectionResponse {
  id: number
  section_title: string
  projectId: number
  visibility: boolean
  deleted: boolean
  ranking: string
}
