import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'

export const AGENT_LOG_NOTE =
  'Saved to the agent log; people do not see it. Add kind question, qa or done to post for people.'

export const AGENT_LOG_UNAVAILABLE =
  'Agent log unavailable, so nothing was saved. Retry later, or add kind question, qa or done to post for people.'

export const AGENT_LOG_NO_TEXT =
  'Nothing was saved: this post has no text the agent log can hold. Add text, or choose kind question, qa or done to post for people.'

export type AgentLogPrincipal = {
  userId: number
  agentId: string
  teamScope: AgentTokenTeamScope | null
  displayName: string
  source: 'agent'
}

export type AgentLogReceipt = {
  id: string
  runId: string
  type: string
  text: string
  createdAt: string
}

export async function prepareAgentLogEntry(principal: AgentLogPrincipal, html: string) {
  const text = await agentLogText(html)
  return text ? { principal, text } : null
}

export async function agentLogText(html: string) {
  const { AGENT_RUN_ACTIVITY_TEXT_MAX_LENGTH } = await import('@/lib/agentRuns/model')
  const text = (await htmlToLogText(html)).slice(0, AGENT_RUN_ACTIVITY_TEXT_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, '')
  return text ? text : null
}

export type AgentLogWrite =
  | { status: 'written'; activity: AgentLogReceipt }
  | { status: 'unreachable' }
  | { status: 'failed' }

export async function writeAgentLogEntry({ principal, taskId, text, idempotencyKey }: {
  principal: AgentLogPrincipal
  taskId: number
  text: string
  idempotencyKey: string | null
}): Promise<AgentLogWrite> {
  const { createRuntimeAgentRun, createAgentRunActivity } = await import('@/lib/agentRuns/service')
  const { parseAgentRunActivityInput } = await import('@/lib/agentRuns/model')
  const run = await createRuntimeAgentRun(principal, { taskId, title: null, source: 'runtime' })
  if (!run) return { status: 'unreachable' }
  const result = await createAgentRunActivity(principal, run.id, parseAgentRunActivityInput({ type: 'thought', text }), idempotencyKey)
  if (!result) return { status: 'failed' }
  const { id, runId, type, text: storedText, createdAt } = result.activity
  return { status: 'written', activity: { id, runId, type, text: storedText, createdAt } }
}

async function htmlToLogText(html: string) {
  const { parse } = await import('node-html-parser')
  const root = parse(html)
  for (const anchor of root.querySelectorAll('a')) {
    const href = anchor.getAttribute('href')?.trim()
    const label = anchor.text.trim()
    if (!href || href === label) continue
    anchor.set_content(escapeHtmlText(label ? `${label} (${href})` : href))
  }
  const text = root.structuredText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).join('\n')
  const imageLines = root.querySelectorAll('img').flatMap((image) => {
    const src = image.getAttribute('src')?.trim()
    if (!src || text.includes(src)) return []
    const alt = image.getAttribute('alt')?.trim()
    return [alt && alt !== src ? `${alt} (${src})` : src]
  })
  return [text, ...imageLines].filter((part) => part.length > 0).join('\n')
}

function escapeHtmlText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
