import { NextRequest, NextResponse } from 'next/server'
import type { TaskWriteProbeResult } from '@/lib/taskCardActions/writeProbe'

// HTPR-5467 — HTTP surface for the production-safe task-write probe.
//
// This file holds only the transport/auth-shape logic. It deliberately imports
// NO auth or database modules so the auth boundary and the healthy/broken/
// inconclusive mapping are testable without booting the full app. The route at
// src/app/api/ops/task-write-probe/route.ts wires the REAL validateMcpAuth and
// the REAL runTaskWriteProbe (and therefore the real writeLocks helper).

type NextResponseOrNull = NextResponse | null

export type TaskWriteProbeHandlerDeps = {
  checkRateLimit: (request: NextRequest) => Promise<NextResponseOrNull>
  validateAuth: (request: NextRequest) => Promise<{ user: { id: number } } | null>
  // The probe writes to the authenticated caller's own probe task, so the
  // principal has to reach it.
  runProbe: (userId: number) => Promise<TaskWriteProbeResult>
}

/**
 * GET /api/ops/task-write-probe
 *
 * HTTP contract (parsed by .github/workflows/prod-health.yml):
 *   - healthy:      200 { success: true,  probe: { status: "healthy", ... } }
 *   - inconclusive: 200 { success: false, probe: { status: "inconclusive", ... } }
 *     (inconclusive is NEVER healthy and never rolls back)
 *   - misconfigured: 503 { success: false, probe: { status: "misconfigured", ... } }
 *     (no fixture provisioned yet: fails the health job, never rolls back)
 *   - broken:       500 { success: false, probe: { status: "broken", error: ... } }
 *
 * Unauthenticated requests are rejected with 401 before any database work.
 */
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

    // 503: the gate is not usable until an operator provisions the fixture.
    const status = result.status === 'broken' ? 500 : result.status === 'misconfigured' ? 503 : 200

    return NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
}