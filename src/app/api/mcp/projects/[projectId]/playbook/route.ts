import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
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

/**
 * GET /api/mcp/projects/:projectId/playbook
 * Returns the board's playbook (working rules + definition-of-done), or null.
 */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
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
      where: { id: projectId, status: 'Normal', ...getProjectWhere(ctx.user.id, ctx.agentId) },
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
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/mcp/projects/:projectId/playbook
 * Sets the board's playbook. Any board member/owner (agent included) may set it.
 * Body: { definition_of_done?: string[], working_rules?: string, notes?: string }.
 */
export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
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

    // Scope the write to a project the caller can access — updateMany with the
    // access filter means a non-member's request updates 0 rows (treated as 404).
    const result = await prisma.project.updateMany({
      where: { id: projectId, status: 'Normal', ...getProjectWhere(ctx.user.id, ctx.agentId) },
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
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
