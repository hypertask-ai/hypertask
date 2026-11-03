import { createHash } from 'node:crypto'
import { z } from 'zod'

const basicCredential = /\bBasic\s+(?=[\w+/=]*[A-Z0-9])[\w+/]{8,}={0,2}(?![\w+/=])/g
const credentialToken = /\bBearer\s+\S+|\b(?:(?:vck_|httk_|htk_|htmk_|eyJ|gh[pousr]_|github_pat_|xox[abposr]-|sk[-_])[\w.-]*)|(?:^|[^a-z0-9])[a-z]{2,6}_(?=[a-z0-9_.-]*[a-z])(?=[a-z0-9_.-]*\d)[a-z0-9_.-]{8,}(?![a-z0-9])/gi
const credential = /vck_|httk_|htk_|htmk_|(?:^|[^a-z0-9])[a-z]{2,6}_(?=[a-z0-9_.-]*[a-z])(?=[a-z0-9_.-]*\d)[a-z0-9_.-]{8,}(?![a-z0-9])|eyJ|(?:^|[^a-z0-9])sk[-_]|ghp_|gho_|github_pat_|xox|Bearer|\d{6,}|[^ _\-.\/:]{20,}/i
const slug = z.string().max(40).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i)
  .refine((value) => !credential.test(value), 'Credential-shaped values are not allowed')
export const FEEDBACK_KINDS = ['bug', 'friction', 'missing', 'idea'] as const

export const aiFeedbackSchema = z.object({
  surface: z.enum(['mcp', 'cli', 'api', 'agent']),
  kind: z.enum(FEEDBACK_KINDS).optional()
    .describe("What the reporter saw: bug, friction, missing or idea. Our own team's agents only; kept on the ticket."),
  client: slug.optional(),
  tool: z.string().regex(/^[a-z0-9_.:\/-]{1,80}$/i)
    .refine((value) => !credential.test(value), 'Credential-shaped values are not allowed').optional(),
  status: z.number().int().min(100).max(599).optional(),
  errorCode: slug.optional(),
  category: z.enum(['call_failed', 'empty_result', 'unexpected_result', 'auth_failed', 'slow', 'user_reported_broken', 'other'])
    .default('other').describe('Structured failure category; defaults to other.'),
  error: z.string().max(5000).optional().describe('Accepted for compatibility. Free text is never stored.'),
  note: z.string().max(5000).optional().describe('A short plain note. Kept, cleaned first, only for our own team\'s agents; never stored for customer agents.'),
}).strict()

export type AiFeedbackInput = z.input<typeof aiFeedbackSchema>

export const automaticFeedbackSchema = aiFeedbackSchema.extend({
  field: z.string().max(80).regex(/^[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+){0,4}$/i)
    .refine((value) => !credential.test(value), 'Credential-shaped values are not allowed').optional(),
})

export type AutomaticFeedbackInput = z.input<typeof automaticFeedbackSchema>

function scrubText(value: string): string {
  return value
    .replace(/&(?:quot|#34|#x22);/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/"[^"]*(?:"|$)|(?:^|[^a-z0-9])'[^']*(?:'|$)|`[^`]*(?:`|$)|“[^”]*(?:”|$)|(?:^|[^a-z0-9])‘[^’]*(?:’|$)/gim, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\b[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g, ' ')
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replace(basicCredential, ' ')
    .replace(credentialToken, ' ')
    .replace(/\d{5,}/g, ' ')
    .replace(/\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function scrubFeedbackText(value: string): string {
  return scrubText(value).slice(0, 300)
}

const plainWord = /^(?:[a-z]{1,15}|[A-Z][a-z]{0,14}|[A-Z]{1,5}|\d{1,4})(?:['-](?:[a-z]{1,15}|\d{1,4}))*[.,;:!?]?$|^--[a-z][a-z-]{0,15}[.,;:!?]?$/

export function scrubFeedbackNote(value: string): string {
  const note = scrubText(value).replace(/\s+/g, ' ').trim().slice(0, 300)
  const words = note.split(' ').filter(Boolean)
  if (words.length === 0 || !words.every((word) => plainWord.test(word)) || credential.test(note) ||
      /\b(?:basic|bearer|authorization)\b/i.test(note)) return ''
  return note
}

export function feedbackFingerprint(input: AutomaticFeedbackInput, stored?: { kind?: string; note?: string }): string {
  const parts = [input.surface, input.tool ?? '', input.status ?? '', input.errorCode ?? '', input.category ?? 'other']
  if (input.field) parts.push(input.field)
  const legacy = createHash('sha256').update(parts.join('|').toLowerCase()).digest('hex')
  const kept = [stored?.kind && `kind:${stored.kind}`, stored?.note && `note:${stored.note}`].filter(Boolean)
  return kept.length === 0 ? legacy : createHash('sha256').update([legacy, ...kept].join('|')).digest('hex')
}

export function feedbackClient(value: unknown): string | undefined {
  if (typeof value !== 'string' || credential.test(value)) return undefined
  const candidate = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/g, '')
  return slug.safeParse(candidate).success ? candidate : undefined
}
