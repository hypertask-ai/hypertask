import { EstimateConstants } from '@/lib/constants/constants'
import type {
  BoardManifestInput,
  ManifestValidationResult,
  ValidatedBoardManifest
} from './types'

const MAX_BOARD_TITLE = 200
const MAX_SECTION_TITLE = 200
const MAX_LABEL_NAME = 100
const MAX_SECTIONS = 50
const MAX_LABELS = 100
const MAX_TASKS = 500
const MAX_TASK_TITLE = 500

function isIsoDateString(s: string): boolean {
  const d = new Date(s.trim())
  return !Number.isNaN(d.getTime())
}

/**
 * Validates the board manifest for POST /api/mcp/teams/:teamId/boards.
 * Aligns task field rules with src/lib/mcp/tasks/validators.ts where applicable.
 */
export function validateBoardManifest(raw: unknown): ManifestValidationResult {
  if (raw === null || typeof raw !== 'object') {
    return {
      ok: false,
      message: 'Request body must be a JSON object',
      field: 'body',
      code: 'invalid_type'
    }
  }

  const body = raw as BoardManifestInput

  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return {
      ok: false,
      message: 'title is required and must be a non-empty string',
      field: 'title',
      code: 'missing_field'
    }
  }

  const title = body.title.trim()
  if (title.length > MAX_BOARD_TITLE) {
    return {
      ok: false,
      message: `title must not exceed ${MAX_BOARD_TITLE} characters`,
      field: 'title',
      code: 'max_length_exceeded'
    }
  }

  if (!Array.isArray(body.sections)) {
    return {
      ok: false,
      message: 'sections must be a non-empty array',
      field: 'sections',
      code: 'invalid_type'
    }
  }

  if (body.sections.length === 0 || body.sections.length > MAX_SECTIONS) {
    return {
      ok: false,
      message: `sections must have between 1 and ${MAX_SECTIONS} entries`,
      field: 'sections',
      code: 'invalid_length'
    }
  }

  const sections: { title: string }[] = []
  const seenSectionTitles = new Set<string>()

  for (let i = 0; i < body.sections.length; i++) {
    const sec = body.sections[i]
    if (!sec || typeof sec !== 'object' || typeof sec.title !== 'string') {
      return {
        ok: false,
        message: `sections[${i}].title is required`,
        field: `sections[${i}].title`,
        code: 'missing_field'
      }
    }
    const st = sec.title.trim()
    if (st.length === 0) {
      return {
        ok: false,
        message: `sections[${i}].title must not be empty`,
        field: `sections[${i}].title`,
        code: 'invalid_value'
      }
    }
    if (st.length > MAX_SECTION_TITLE) {
      return {
        ok: false,
        message: `sections[${i}].title must not exceed ${MAX_SECTION_TITLE} characters`,
        field: `sections[${i}].title`,
        code: 'max_length_exceeded'
      }
    }
    if (seenSectionTitles.has(st)) {
      return {
        ok: false,
        message: `Duplicate section title "${st}"`,
        field: `sections[${i}].title`,
        code: 'duplicate'
      }
    }
    seenSectionTitles.add(st)
    sections.push({ title: st })
  }

  let labels: { name: string; color?: string }[] = []
  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels)) {
      return {
        ok: false,
        message: 'labels must be an array when provided',
        field: 'labels',
        code: 'invalid_type'
      }
    }
    if (body.labels.length > MAX_LABELS) {
      return {
        ok: false,
        message: `labels must not exceed ${MAX_LABELS} entries`,
        field: 'labels',
        code: 'invalid_length'
      }
    }
    const seenLabelNames = new Set<string>()
    labels = []
    for (let i = 0; i < body.labels.length; i++) {
      const lb = body.labels[i]
      if (!lb || typeof lb !== 'object' || typeof lb.name !== 'string') {
        return {
          ok: false,
          message: `labels[${i}].name is required`,
          field: `labels[${i}].name`,
          code: 'missing_field'
        }
      }
      const nm = lb.name.trim()
      if (nm.length === 0) {
        return {
          ok: false,
          message: `labels[${i}].name must not be empty`,
          field: `labels[${i}].name`,
          code: 'invalid_value'
        }
      }
      if (nm.length > MAX_LABEL_NAME) {
        return {
          ok: false,
          message: `labels[${i}].name must not exceed ${MAX_LABEL_NAME} characters`,
          field: `labels[${i}].name`,
          code: 'max_length_exceeded'
        }
      }
      if (seenLabelNames.has(nm)) {
        return {
          ok: false,
          message: `Duplicate label name "${nm}"`,
          field: `labels[${i}].name`,
          code: 'duplicate'
        }
      }
      seenLabelNames.add(nm)
      const color =
        lb.color !== undefined && typeof lb.color === 'string' ? lb.color : undefined
      labels.push({ name: nm, color })
    }
  }

  const labelNameSet = new Set(labels.map((l) => l.name))

  let tasks: ValidatedBoardManifest['tasks'] = []

  if (body.tasks !== undefined) {
    if (!Array.isArray(body.tasks)) {
      return {
        ok: false,
        message: 'tasks must be an array when provided',
        field: 'tasks',
        code: 'invalid_type'
      }
    }
    if (body.tasks.length > MAX_TASKS) {
      return {
        ok: false,
        message: `tasks must not exceed ${MAX_TASKS} entries`,
        field: 'tasks',
        code: 'invalid_length'
      }
    }

    tasks = []

    for (let i = 0; i < body.tasks.length; i++) {
      const t = body.tasks[i]
      if (!t || typeof t !== 'object') {
        return {
          ok: false,
          message: `tasks[${i}] must be an object`,
          field: `tasks[${i}]`,
          code: 'invalid_type'
        }
      }

      if (typeof t.title !== 'string' || t.title.trim().length === 0) {
        return {
          ok: false,
          message: `tasks[${i}].title is required`,
          field: `tasks[${i}].title`,
          code: 'missing_field'
        }
      }

      const taskTitle = t.title.trim()
      if (taskTitle.length > MAX_TASK_TITLE) {
        return {
          ok: false,
          message: `tasks[${i}].title must not exceed ${MAX_TASK_TITLE} characters`,
          field: `tasks[${i}].title`,
          code: 'max_length_exceeded'
        }
      }

      const hasIndex =
        t.section_index !== undefined &&
        t.section_index !== null &&
        typeof t.section_index === 'number'
      const hasTitle =
        t.section_title !== undefined &&
        t.section_title !== null &&
        typeof t.section_title === 'string'

      if (hasIndex === hasTitle) {
        return {
          ok: false,
          message: `tasks[${i}] must specify exactly one of section_index or section_title`,
          field: `tasks[${i}]`,
          code: 'invalid_section_target'
        }
      }

      let sectionIndex = -1

      if (hasIndex) {
        if (!Number.isInteger(t.section_index) || t.section_index! < 0) {
          return {
            ok: false,
            message: `tasks[${i}].section_index must be a non-negative integer`,
            field: `tasks[${i}].section_index`,
            code: 'invalid_type'
          }
        }
        if (t.section_index! >= sections.length) {
          return {
            ok: false,
            message: `tasks[${i}].section_index ${t.section_index} is out of range`,
            field: `tasks[${i}].section_index`,
            code: 'out_of_range'
          }
        }
        sectionIndex = t.section_index!
      } else {
        const targetTitle = (t.section_title as string).trim()
        const matchIdx = sections.findIndex((s) => s.title === targetTitle)
        if (matchIdx === -1) {
          return {
            ok: false,
            message: `Task "${taskTitle}" references section_title "${targetTitle}" which does not match any section.`,
            field: `tasks[${i}].section_title`,
            code: 'unresolved_section'
          }
        }
        sectionIndex = matchIdx
      }

      if (t.description !== undefined && t.description !== null) {
        if (typeof t.description !== 'string') {
          return {
            ok: false,
            message: `tasks[${i}].description must be a string when provided`,
            field: `tasks[${i}].description`,
            code: 'invalid_type'
          }
        }
      }

      const priority = t.priority !== undefined ? t.priority : 0
      if (typeof priority !== 'number' || priority < 0 || priority > 4) {
        return {
          ok: false,
          message: `tasks[${i}].priority must be between 0 and 4`,
          field: `tasks[${i}].priority`,
          code: 'invalid_range'
        }
      }

      const estimate = t.estimate !== undefined ? t.estimate : 0
      if (typeof estimate !== 'number' || estimate < 0 || estimate > 7) {
        return {
          ok: false,
          message: `tasks[${i}].estimate must be between 0 and 7`,
          field: `tasks[${i}].estimate`,
          code: 'invalid_range'
        }
      }
      if (estimate > 0) {
        const estimateConstant = EstimateConstants.find((e) => e.estimate_index === estimate)
        if (!estimateConstant) {
          return {
            ok: false,
            message: `tasks[${i}].estimate index ${estimate} is not supported`,
            field: `tasks[${i}].estimate`,
            code: 'unsupported_value'
          }
        }
      }

      let dueDate: string | undefined
      if (t.due_date !== undefined && t.due_date !== null) {
        if (typeof t.due_date !== 'string' || t.due_date.trim().length === 0) {
          return {
            ok: false,
            message: `tasks[${i}].due_date must be a non-empty ISO 8601 string when provided`,
            field: `tasks[${i}].due_date`,
            code: 'invalid_type'
          }
        }
        if (!isIsoDateString(t.due_date)) {
          return {
            ok: false,
            message: `tasks[${i}].due_date must be a valid ISO 8601 date or datetime`,
            field: `tasks[${i}].due_date`,
            code: 'invalid_date'
          }
        }
        dueDate = t.due_date.trim()
      }

      let labelNames: string[] = []
      if (t.label_names !== undefined && t.label_names !== null) {
        if (!Array.isArray(t.label_names)) {
          return {
            ok: false,
            message: `tasks[${i}].label_names must be an array`,
            field: `tasks[${i}].label_names`,
            code: 'invalid_type'
          }
        }
        for (let j = 0; j < t.label_names.length; j++) {
          const ln = t.label_names[j]
          if (typeof ln !== 'string') {
            return {
              ok: false,
              message: `tasks[${i}].label_names[${j}] must be a string`,
              field: `tasks[${i}].label_names[${j}]`,
              code: 'invalid_type'
            }
          }
          const trimmed = ln.trim()
          if (!labelNameSet.has(trimmed)) {
            return {
              ok: false,
              message: `Task "${taskTitle}" references label "${trimmed}" which is not in this manifest labels list`,
              field: `tasks[${i}].label_names[${j}]`,
              code: 'unknown_label'
            }
          }
          labelNames.push(trimmed)
        }
      }

      tasks.push({
        title: taskTitle,
        description:
          typeof t.description === 'string' && t.description.length > 0
            ? t.description
            : undefined,
        sectionIndex,
        labelNames,
        priority,
        estimate,
        dueDate
      })
    }
  }

  let description: string | undefined
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') {
      return {
        ok: false,
        message: 'description must be a string when provided',
        field: 'description',
        code: 'invalid_type'
      }
    }
    const d = body.description.trim()
    if (d.length > 0) {
      description = body.description
    }
  }

  const data: ValidatedBoardManifest = {
    title,
    description,
    sections,
    labels,
    tasks
  }

  return { ok: true, data }
}
