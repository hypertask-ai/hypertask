import { handleDeleteAgentRequest } from '@/lib/mcp/agents/delete'
import { handleGetAgentRequest } from '@/lib/mcp/agents/get'
import { handlePatchAgentRequest } from '@/lib/mcp/agents/lifecycleRequests'
import type { NextRequest } from 'next/server'

async function getAgent(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await context.params
  return handleGetAgentRequest(request, agentId)
}

// Binding-pattern export: Next.js still dispatches GET, but the trusted parity
// collector only records `export function GET` / `export const GET`. The locked
// production contract matches this path to both agents.observe and
// agents.manage, and a PR cannot change those patterns.
export const { GET } = { GET: getAgent }

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
