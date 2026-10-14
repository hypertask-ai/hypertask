import { NextRequest, NextResponse } from 'next/server'
import type { TaskWriteProbeResult } from '@/lib/taskCardActions/writeProbe'


type NextResponseOrNull = NextResponse | null

export type TaskWriteProbeHandlerDeps = {
  checkRateLimit: (request: NextRequest) => Promise<NextResponseOrNull>
  validateAuth: (request: NextRequest) => Promise<{ user: { id: number } } | null>
  runProbe: (userId: number) => Promise<TaskWriteProbeResult>
}

export function createTaskWriteProbeHandler(deps: TaskWriteProbeHandlerDeps) {
  return async function GET(request: NextRequest): Promise<NextResponse> {
    const rateLimited = await deps.checkRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await deps.validateAuth(request)
    if (!ctx?.user?.id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.',
        },
        { status: 401 },
      )
    }

    const result = await deps.runProbe(ctx.user.id)

    const body =
      result.status === 'healthy'
        ? { success: true, probe: result }
        : { success: false, probe: result }

    const status = result.status === 'broken' ? 500 : result.status === 'misconfigured' ? 503 : 200

    return NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
}