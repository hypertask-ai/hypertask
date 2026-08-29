export const evidenceTypes = [
  'TestRun',
  'Screenshot',
  'Deploy',
  'Diff',
  'Link',
  'Other',
] as const

export type EvidenceTypeValue = (typeof evidenceTypes)[number]

// Accept the enum name ("TestRun") or a snake/loose form ("test_run", "test run")
// agents are likely to send. Absent -> Other. Unknown string -> null (rejected).
const LOOSE_TO_ENUM: Record<string, EvidenceTypeValue> = {
  testrun: 'TestRun',
  test_run: 'TestRun',
  test: 'TestRun',
  screenshot: 'Screenshot',
  deploy: 'Deploy',
  deployment: 'Deploy',
  diff: 'Diff',
  link: 'Link',
  url: 'Link',
  other: 'Other',
}

export function normalizeEvidenceType(
  value?: unknown
): EvidenceTypeValue | null {
  if (value === undefined || value === null) return 'Other'
  if (typeof value !== 'string') return null
  const exact = evidenceTypes.find((t) => t === value)
  if (exact) return exact
  return LOOSE_TO_ENUM[value.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null
}

const MAX_TITLE = 300
const MAX_SUMMARY = 5000
const MAX_URL = 2000

export type EvidenceInput = {
  type: EvidenceTypeValue
  title?: string
  url?: string
  summary?: string
}

export type EvidenceParseResult =
  | { ok: true; value: EvidenceInput }
  | { ok: false; error: string; field: string }

/** Validate an evidence payload: normalized type, http(s) url, size caps, and
 *  at least one of title/url/summary so a piece of evidence isn't empty. */
export function parseEvidenceInput(body: {
  type?: unknown
  title?: unknown
  url?: unknown
  summary?: unknown
}): EvidenceParseResult {
  const type = normalizeEvidenceType(body.type)
  if (type === null) {
    return { ok: false, field: 'type', error: `type must be one of ${evidenceTypes.join(', ')}` }
  }

  const str = (v: unknown, field: string, max: number): { ok: true; v?: string } | { ok: false; error: string; field: string } => {
    if (v === undefined || v === null) return { ok: true }
    if (typeof v !== 'string') return { ok: false, field, error: `${field} must be a string` }
    const t = v.trim()
    if (t.length > max) return { ok: false, field, error: `${field} may be at most ${max} characters` }
    return { ok: true, v: t === '' ? undefined : t }
  }

  const title = str(body.title, 'title', MAX_TITLE)
  if (!title.ok) return title
  const summary = str(body.summary, 'summary', MAX_SUMMARY)
  if (!summary.ok) return summary

  let url: string | undefined
  if (body.url !== undefined && body.url !== null) {
    if (typeof body.url !== 'string') return { ok: false, field: 'url', error: 'url must be a string' }
    const u = body.url.trim()
    if (u !== '') {
      if (u.length > MAX_URL) return { ok: false, field: 'url', error: `url may be at most ${MAX_URL} characters` }
      let parsed: URL
      try {
        parsed = new URL(u)
      } catch {
        return { ok: false, field: 'url', error: 'url must be a valid URL' }
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, field: 'url', error: 'url must be http or https' }
      }
      url = u
    }
  }

  if (!title.v && !url && !summary.v) {
    return { ok: false, field: 'evidence', error: 'provide at least one of title, url, or summary' }
  }

  return { ok: true, value: { type, title: title.v, url, summary: summary.v } }
}
