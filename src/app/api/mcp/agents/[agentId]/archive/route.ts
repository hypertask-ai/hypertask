import { handleArchiveAgentRequest } from '@/lib/mcp/agents/lifecycleRequests'
import type { NextRequest } from 'next/server'

/** Archives an owned managed agent without revoking its credential or runtime. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await context.params
  return handleArchiveAgentRequest(request, agentId)
}
