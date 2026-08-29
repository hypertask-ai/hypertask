import { escapeHtml } from '@/utils/helperFunctions/escapeHtml'

/**
 * Render an agent escalation as a Tiptap-safe HTML comment: a clear heading, the
 * reason, and (optionally) a summary of what was already tried. All caller text
 * is escaped — an agent's reason/summary is untrusted input.
 */
export function buildEscalationCommentHtml(input: {
  reason: string
  attemptsSummary?: string
}): string {
  const parts = [
    '<p><strong>🚨 Agent escalation — needs a human.</strong></p>',
    `<p><strong>Reason:</strong> ${escapeHtml(input.reason)}</p>`,
  ]
  if (input.attemptsSummary) {
    parts.push(`<p><strong>Already tried:</strong> ${escapeHtml(input.attemptsSummary)}</p>`)
  }
  return parts.join('')
}
