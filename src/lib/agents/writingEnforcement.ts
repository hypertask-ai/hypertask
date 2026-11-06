import { assertAgentWriting, type AgentWritingContext } from '@/lib/agents/writing'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8798_WRITING_HOUSE_RULES_FLAG } from '@/lib/flags/definitions/htpr-8798-writing-house-rules'
import { YPER4_910_AGENT_WRITING_FLAG } from '@/lib/flags/definitions/yper4-910-agent-writing'

export async function agentWritingPolicyEnabled(userId: number): Promise<boolean> {
  const { isFeatureEnabled } = await import('@/lib/flags')
  try {
    return await isFeatureEnabled(YPER4_910_AGENT_WRITING_FLAG, userId)
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
  const houseRules = context.houseRules === true || await isFeatureEnabled(HTPR_8798_WRITING_HOUSE_RULES_FLAG, userId)
  if (await agentWritingPolicyEnabled(userId)) assertAgentWriting(agentId, fields, previous, { ...context, houseRules })
}
