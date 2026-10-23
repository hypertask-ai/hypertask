import type { McpAuthContext } from "@/lib/mcp/auth/types";
import { withAgentScopeRequest, prepareAgentScope } from "@/lib/auth/agentScope";
import { NextRequest, NextResponse } from 'next/server'
import type { TaskWriteProbeResult, TaskWriteProbeDeps } from '@/lib/taskCardActions/writeProbe'


type NextResponseOrNull = NextResponse | null

export type TaskWriteProbeHandlerDeps = {
  checkRateLimit: (request: NextRequest) => Promise<NextResponseOrNull>
  validateAuth: (request: NextRequest) => Promise<McpAuthContext | null>
  runProbe: (userId: number, options?: TaskWriteProbeDeps) => Promise<TaskWriteProbeResult>
}

export function createTaskWriteProbeHandler(deps: TaskWriteProbeHandlerDeps) {
  return async function GET(request: NextRequest): Promise<NextResponse> {
    return withAgentScopeRequest(request, async () => {
    const rateLimited = await deps.checkRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await deps.validateAuth(request)
    if (!ctx?.user?.id || (ctx.agentId && ctx.teamScope === undefined)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.',
        },
        { status: 401 },
      )
    }

    await prepareAgentScope(ctx.user.id, ctx.agentId)
    const result = await deps.runProbe(ctx.user.id, { agentId: ctx.agentId, teamScope: ctx.teamScope })

    const body =
      result.status === 'healthy'
        ? { success: true, probe: result }
        : { success: false, probe: result }

    const status = result.status === 'broken' ? 500 : result.status === 'misconfigured' ? 503 : 200

    return NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
    })
  }
}