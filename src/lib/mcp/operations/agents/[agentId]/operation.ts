import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
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

export const { GET } = { GET: wrapMcpRoute(getAgent) }

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest, context: { params: Promise<{ agentId: string }> }) => {
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
    reportMcpOperationCrash(request, error)
    return noStore({ success: false, error: 'Failed to open agent run' }, 500)
  }

  })(request, context)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest, context: { params: Promise<{ agentId: string }> }) => {
  const { agentId } = await context.params
  return handleDeleteAgentRequest(request, agentId)

  })(request, context)
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest, context: { params: Promise<{ agentId: string }> }) => {
  const { agentId } = await context.params
  return handlePatchAgentRequest(request, agentId)

  })(request, context)
}
