import { escapeHtml } from '@/utils/helperFunctions/escapeHtml'

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
