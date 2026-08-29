export interface BoardManifestLabelInput {
  name: string
  color?: string
}

export interface BoardManifestSectionInput {
  title: string
}

export interface BoardManifestTaskInput {
  title: string
  description?: string
  section_index?: number
  section_title?: string
  label_names?: string[]
  priority?: number
  estimate?: number
  due_date?: string
}

/** Raw body from MCP / agent (before validation). */
export interface BoardManifestInput {
  title: string
  description?: string
  sections: BoardManifestSectionInput[]
  labels?: BoardManifestLabelInput[]
  tasks?: BoardManifestTaskInput[]
  source_summary?: string
}

export interface ValidatedBoardManifest {
  title: string
  description?: string
  sections: { title: string }[]
  labels: { name: string; color?: string }[]
  tasks: {
    title: string
    description?: string
    sectionIndex: number
    labelNames: string[]
    priority: number
    estimate: number
    dueDate?: string
  }[]
}

export type ManifestValidationFailure = {
  ok: false
  message: string
  field: string
  code: string
}

export type ManifestValidationResult =
  | { ok: true; data: ValidatedBoardManifest }
  | ManifestValidationFailure
