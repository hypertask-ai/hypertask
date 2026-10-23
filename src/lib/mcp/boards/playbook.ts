export interface BoardPlaybook {
  definition_of_done?: string[]
  working_rules?: string
  notes?: string
}

const MAX_CHECKLIST_ITEMS = 50
const MAX_ITEM_CHARS = 500
const MAX_TEXT_CHARS = 5000

export type PlaybookParseResult =
  | { ok: true; value: BoardPlaybook }
  | { ok: false; error: string }

export function parseBoardPlaybook(input: unknown): PlaybookParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'playbook must be a JSON object' }
  }
  const src = input as Record<string, unknown>
  const out: BoardPlaybook = {}

  if (src.definition_of_done !== undefined) {
    const dod = src.definition_of_done
    if (
      !Array.isArray(dod) ||
      !dod.every((x) => typeof x === 'string')
    ) {
      return { ok: false, error: 'definition_of_done must be an array of strings' }
    }
    if (dod.length > MAX_CHECKLIST_ITEMS) {
      return { ok: false, error: `definition_of_done may have at most ${MAX_CHECKLIST_ITEMS} items` }
    }
    const items = (dod as string[]).map((s) => s.trim()).filter((s) => s !== '')
    if (items.some((s) => s.length > MAX_ITEM_CHARS)) {
      return { ok: false, error: `each definition_of_done item may be at most ${MAX_ITEM_CHARS} characters` }
    }
    out.definition_of_done = items
  }

  for (const key of ['working_rules', 'notes'] as const) {
    if (src[key] !== undefined) {
      if (typeof src[key] !== 'string') {
        return { ok: false, error: `${key} must be a string` }
      }
      const v = (src[key] as string).trim()
      if (v.length > MAX_TEXT_CHARS) {
        return { ok: false, error: `${key} may be at most ${MAX_TEXT_CHARS} characters` }
      }
      if (v !== '') out[key] = v
    }
  }

  return { ok: true, value: out }
}
