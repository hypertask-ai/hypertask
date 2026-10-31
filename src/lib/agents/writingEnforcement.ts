import { assertAgentWriting } from '@/lib/agents/writing'
import { YPER4_910_AGENT_WRITING_FLAG } from '@/lib/flags/definitions/yper4-910-agent-writing'

export async function agentWritingPolicyEnabled(userId: number): Promise<boolean> {
  const { isFeatureEnabled } = await import('@/lib/flags')
  return isFeatureEnabled(YPER4_910_AGENT_WRITING_FLAG, userId)
}

export async function enforceAgentWriting(
  userId: number,
  agentId: string | null | undefined,
  fields: Parameters<typeof assertAgentWriting>[1],
  previous: Parameters<typeof assertAgentWriting>[2] = {},
): Promise<void> {
  if (!agentId) return
  if (await agentWritingPolicyEnabled(userId)) assertAgentWriting(agentId, fields, previous)
}
