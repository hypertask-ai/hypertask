import { createHash } from 'node:crypto'
import { z } from 'zod'

const credential = /vck_|httk_|htk_|htmk_|(?:^|[^a-z0-9])[a-z]{2,6}_(?=[a-z0-9_.-]*[a-z])(?=[a-z0-9_.-]*\d)[a-z0-9_.-]{8,}(?![a-z0-9])|eyJ|(?:^|[^a-z0-9])sk[-_]|ghp_|gho_|github_pat_|xox|Bearer|\d{6,}|[^ _\-.\/:]{20,}/i
const slug = z.string().max(40).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i)
  .refine((value) => !credential.test(value), 'Credential-shaped values are not allowed')
export const aiFeedbackSchema = z.object({
  surface: z.enum(['mcp', 'cli', 'api', 'agent']),
  client: slug.optional(),
  tool: z.string().regex(/^[a-z0-9_.:\/-]{1,80}$/i)
    .refine((value) => !credential.test(value), 'Credential-shaped values are not allowed').optional(),
  status: z.number().int().min(100).max(599).optional(),
  errorCode: slug.optional(),
  category: z.enum(['call_failed', 'empty_result', 'unexpected_result', 'auth_failed', 'slow', 'user_reported_broken', 'other'])
    .default('other').describe('Structured failure category; defaults to other.'),
  error: z.string().max(5000).optional().describe('Accepted for compatibility. Free text is never stored.'),
  note: z.string().max(5000).optional().describe('Accepted for compatibility. Free text is never stored.'),
}).strict()

export type AiFeedbackInput = z.input<typeof aiFeedbackSchema>

export const automaticFeedbackSchema = aiFeedbackSchema.extend({
  field: z.string().max(80).regex(/^[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+){0,4}$/i)
    .refine((value) => !credential.test(value), 'Credential-shaped values are not allowed').optional(),
})

export type AutomaticFeedbackInput = z.input<typeof automaticFeedbackSchema>

export function scrubFeedbackText(value: string): string {
  return value
    .replace(/&(?:quot|#34|#x22);/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/"[^"]*(?:"|$)|'[^']*(?:'|$)|`[^`]*(?:`|$)|“[^”]*(?:”|$)|‘[^’]*(?:’|$)/gm, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\b[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g, ' ')
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replace(/\d{5,}/g, ' ')
    .replace(/\b(?:Bearer\s+\S+|(?:vck_|httk_|htk_|htmk_|eyJ)[\w.-]+)\b/gi, ' ')
    .replace(/\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

export function feedbackFingerprint(input: AutomaticFeedbackInput): string {
  const parts = [input.surface, input.tool ?? '', input.status ?? '', input.errorCode ?? '', input.category ?? 'other']
  if (input.field) parts.push(input.field)
  return createHash('sha256')
    .update(parts.join('|').toLowerCase())
    .digest('hex')
}

export function feedbackClient(value: unknown): string | undefined {
  if (typeof value !== 'string' || credential.test(value)) return undefined
  const candidate = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/g, '')
  return slug.safeParse(candidate).success ? candidate : undefined
}
