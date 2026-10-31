import { assertAgentWriting } from '@/lib/agents/writing'
import { YPER4_910_AGENT_WRITING_FLAG } from '@/lib/flags/definitions/yper4-910-agent-writing'

export async function agentWritingPolicyEnabled(): Promise<boolean> {
  const { featureFlagCandidateUserIds } = await import('@/lib/flags')
  return (await featureFlagCandidateUserIds(YPER4_910_AGENT_WRITING_FLAG))?.length !== 0
}

export async function enforceAgentWriting(...writing: Parameters<typeof assertAgentWriting>): Promise<void> {
  if (await agentWritingPolicyEnabled()) assertAgentWriting(...writing)
}
