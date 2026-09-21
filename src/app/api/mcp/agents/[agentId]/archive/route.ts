import { withoutAuth } from "#with-auth";
import { handleArchiveAgentRequest } from '@/lib/mcp/agents/lifecycleRequests'
import type { NextRequest } from 'next/server'

/** Archives an owned managed agent without revoking its credential or runtime. */
async function POSTHandler(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await context.params
  return handleArchiveAgentRequest(request, agentId)
}

export const POST = withoutAuth(POSTHandler);
