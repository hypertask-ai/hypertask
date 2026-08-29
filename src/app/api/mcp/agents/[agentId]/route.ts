import { handleDeleteAgentRequest } from '@/lib/mcp/agents/delete'
import { handlePatchAgentRequest } from '@/lib/mcp/agents/lifecycleRequests'
import type { NextRequest } from 'next/server'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await context.params
  return handleDeleteAgentRequest(request, agentId)
}

/**
 * Renames an agent with `{"display_name": "..."}`, switches a disabled agent
 * back on with `{"revoked": false}`, or files it away with
 * `{"archived": true}`. DELETE above is the irreversible one; PATCH keeps the
 * reversible agent-management operations together for the CLI and MCP.
 * Board membership changes use this same owned-agent PATCH operation.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await context.params
  return handlePatchAgentRequest(request, agentId)
}
