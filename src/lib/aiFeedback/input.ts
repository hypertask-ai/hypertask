import { createHash } from 'node:crypto'
import { z } from 'zod'

const slug = z.string().max(40).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i)
export const aiFeedbackSchema = z.object({
  surface: z.enum(['mcp', 'cli', 'api', 'agent']),
  client: slug.optional(),
  tool: z.string().regex(/^[a-z0-9_.:\/-]{1,80}$/i).optional(),
  status: z.number().int().min(100).max(599).optional(),
  errorCode: slug.optional(),
  error: z.string().max(5000).optional(),
  note: z.string().max(5000).optional(),
}).strict()

export type AiFeedbackInput = z.infer<typeof aiFeedbackSchema>

export function scrubFeedbackText(value: string): string {
  return value
    // Decode quote entities before removing segments so HTML cannot hide quotes.
    .replace(/&(?:quot|#34|#x22);/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/"[^"]*(?:"|$)|'[^']*(?:'|$)|`[^`]*(?:`|$)|“[^”]*(?:”|$)|‘[^’]*(?:’|$)/gm, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\b[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g, ' ')
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replace(/\d{5,}/g, ' ')
    .replace(/\b(?:Bearer\s+\S+|(?:htk_|htmk_|eyJ)[\w.-]+)\b/gi, ' ')
    .replace(/\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

export function feedbackFingerprint(input: AiFeedbackInput): string {
  return createHash('sha256')
    .update([input.surface, input.tool ?? '', input.status ?? '', input.errorCode ?? ''].join('|').toLowerCase())
    .digest('hex')
}

export function feedbackClient(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/g, '')
  return slug.safeParse(candidate).success ? candidate : undefined
}
