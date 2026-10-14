import { normalizeBlockHtml } from '@/lib/mcp/normalizeBlockHtml'
import { normalizeAssistantHtml } from './normalizeAssistantHtml'
import { sanitizeRichHtml } from './sanitizeRichHtml'

export function toStoredHtml(text: string): string {
  return sanitizeRichHtml(normalizeBlockHtml(normalizeAssistantHtml(text)))
}
