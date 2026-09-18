import { NextRequest, NextResponse } from 'next/server'
import { handleDeleteAgentRequest } from '@/lib/mcp/agents/delete'
import { handleGetAgentRequest } from '@/lib/mcp/agents/get'
import { handlePatchAgentRequest } from '@/lib/mcp/agents/lifecycleRequests'
import {
  authenticateAgentRunRequest,
  createRuntimeAgentRun,
  runtimeAgentRunsEnabledFor,
} from '@/lib/agentRuns/service'
import {
  AgentRunInputError,
  parseRuntimeAgentRunInput,
} from '@/lib/agentRuns/model'
import { checkMcpRateLimit } from '@/lib/mcp/auth'

const noStore = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })

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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  // With no collection route file, Next dispatches /agents/runs here while the
  // sibling /agents/runs/[id] routes keep their more-specific static matches.
  const { agentId } = await context.params
  if (agentId !== 'runs') {
    return noStore({ success: false, error: 'Not found' }, 404)
  }

  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  try {
    const principal = await authenticateAgentRunRequest(request)
    if (!principal) {
      return noStore(
        { success: false, error: 'Invalid or missing authentication' },
        401
      )
    }
    if (principal.source !== 'agent') {
      return noStore(
        { success: false, error: 'Opening runs requires an agent token' },
        403
      )
    }
    if (!(await runtimeAgentRunsEnabledFor(principal))) {
      return noStore({ success: false, error: 'Not found' }, 404)
    }

    const input = parseRuntimeAgentRunInput(
      await request.json().catch(() => null)
    )
    const run = await createRuntimeAgentRun(principal, input)
    if (!run) return noStore({ success: false, error: 'Task not found' }, 404)
    return noStore({ success: true, run }, 201)
  } catch (error) {
    if (error instanceof AgentRunInputError) {
      return noStore({ success: false, error: error.message }, 400)
    }
    console.error('[agent-run] runtime open failed', error)
    return noStore({ success: false, error: 'Failed to open agent run' }, 500)
  }
}

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
