import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes"
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isPlanLimitReachedError, planLimitResponse } from '@/lib/planLimits'
import { updateProjectStatus } from '@/utils/controllers/projects/boardQuota'
import deleteProject from '@/utils/controllers/projects/delete'

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }
    const roleRefusal = await requireAgentWriteRole(ctx)
    if (roleRefusal) return roleRefusal

    let body: { project_id?: unknown; status?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }

    const projectId = Number(body.project_id)
    if (!Number.isInteger(projectId) || projectId < 1) {
      return NextResponse.json(
        { success: false, error: 'project_id must be a positive integer' },
        { status: 400 }
      )
    }

    const status = body.status === undefined ? 'Archive' : body.status
    if (status !== 'Archive' && status !== 'Normal' && status !== 'Deleted') {
      return NextResponse.json(
        { success: false, error: "status must be 'Archive', 'Normal', or 'Deleted'" },
        { status: 400 }
      )
    }

    if (ctx.agentId && !(await prisma.project.findFirst({
      where: { id: projectId, ...taskWriteAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
      select: { id: true },
    }))) {
      return NextResponse.json({ success: false, error: 'Board not found' }, { status: 404 })
    }

    if (ctx.agentId) recordAgentBoardScopeMiss(projectId, "write");
    if (status === 'Deleted') {
      const response = await deleteProject(projectId, ctx.user.id)
      return NextResponse.json(response.json, { status: response.status })
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: ctx.user.id, status: { not: 'Deleted' }, ...(ctx.agentId || ctx.teamScope != null ? taskWriteAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) : {}) },
      select: { id: true, name: true, title: true, status: true },
    })

    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Board not found, or you do not own it' },
        { status: 404 }
      )
    }

    const updated = await updateProjectStatus(project.id, status, {
      actorUserId: ctx.user.id,
      agentId: ctx.agentId,
      entryPoint: 'mcp.projects.archive',
    })

    return NextResponse.json({ success: true, project: updated })
  } catch (error) {
    if (isPlanLimitReachedError(error)) {
      const refusal = planLimitResponse(error)
      return NextResponse.json(refusal.body, { status: refusal.status })
    }
    console.error('[MCP Archive Board] Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }

  })(request)
}
