import { assertAgentWriting, type AgentWritingContext } from '@/lib/agents/writing'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8798_WRITING_HOUSE_RULES_FLAG } from '@/lib/flags/definitions/htpr-8798-writing-house-rules'
import { HTPR_8889_PEOPLE_COMMENT_WRITING_FLAG } from '@/lib/flags/definitions/htpr-8889-people-comment-writing'
import { YPER4_910_AGENT_WRITING_FLAG } from '@/lib/flags/definitions/yper4-910-agent-writing'

export async function agentWritingPolicyEnabled(userId: number): Promise<boolean> {
  const { isFeatureEnabled } = await import('@/lib/flags')
  try {
    return await isFeatureEnabled(YPER4_910_AGENT_WRITING_FLAG, userId)
  } catch {
    return true
  }
}

async function houseRulesEnabled(userId: number, context: AgentWritingContext): Promise<boolean> {
  if (context.houseRules === true) return true
  try {
    return await isFeatureEnabled(HTPR_8798_WRITING_HOUSE_RULES_FLAG, userId)
  } catch {
    return true
  }
}

export async function peopleCommentWholeCheckEnabled(userId: number): Promise<boolean> {
  try {
    return await isFeatureEnabled(HTPR_8889_PEOPLE_COMMENT_WRITING_FLAG, userId)
  } catch {
    return true
  }
}

export async function enforceAgentWriting(
  userId: number,
  agentId: string | null | undefined,
  fields: Parameters<typeof assertAgentWriting>[1],
  previous: Parameters<typeof assertAgentWriting>[2] = {},
  context: AgentWritingContext = {},
): Promise<void> {
  if (!agentId) return
  const houseRules = await houseRulesEnabled(userId, context)
  const checkedPrevious = context.commentEdit && await peopleCommentWholeCheckEnabled(userId) ? {} : previous
  if (await agentWritingPolicyEnabled(userId)) assertAgentWriting(agentId, fields, checkedPrevious, { ...context, houseRules })
}
