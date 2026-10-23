import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { handleArchiveAgentRequest } from '@/lib/mcp/agents/lifecycleRequests'
import type { NextRequest } from 'next/server'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest, context: { params: Promise<{ agentId: string }> }) => {
  const { agentId } = await context.params
  return handleArchiveAgentRequest(request, agentId)

  })(request, context)
}
