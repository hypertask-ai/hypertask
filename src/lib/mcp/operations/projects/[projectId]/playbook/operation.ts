import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard'
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import { parseBoardPlaybook } from '@/lib/mcp/boards/playbook'

function unauthorized() {
  return NextResponse.json(
    { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
    { status: 401 }
  )
}

function parseProjectId(raw: string): number | null {
  const id = parseInt(raw, 10)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const { projectId: rawId } = await props.params
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return unauthorized()

    const projectId = parseProjectId(rawId)
    if (projectId === null) {
      return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 })
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, status: 'Normal', ...getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
      select: { id: true, playbook: true },
    })
    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      projectId: project.id,
      playbook: project.playbook ?? null,
    })
  } catch (error) {
    console.error('[MCP Board Playbook] GET Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }

  })(request)
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const { projectId: rawId } = await props.params
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return unauthorized()
    const roleRefusal = await requireAgentWriteRole(ctx)
    if (roleRefusal) return roleRefusal

    const projectId = parseProjectId(rawId)
    if (projectId === null) {
      return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const parsed = parseBoardPlaybook(body)
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, error: parsed.error, code: 'invalid_field', field: 'playbook' },
        { status: 400 }
      )
    }

    const result = await prisma.project.updateMany({
      where: { id: projectId, status: 'Normal', ...getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
      data: { playbook: parsed.value as Prisma.InputJsonValue },
    })
    if (result.count === 0) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, projectId, playbook: parsed.value })
  } catch (error) {
    console.error('[MCP Board Playbook] PUT Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }

  })(request)
}
