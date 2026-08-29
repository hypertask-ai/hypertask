import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, createUnauthorizedResponse, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { validateProjectAccess } from '@/lib/mcp/tasks/services'
import { broadcastBoardChange } from '@/lib/realtime/server'
import { readJsonBody } from '@/lib/mcp/readJsonBody'

/**
 * GET /api/mcp/projects/:projectId/labels
 *
 * Lists the labels defined on a project.
 * Backs the CLI/MCP list_labels tool (parity with the AI-chat tool).
 *
 * Auth: MCP JWT (Bearer token)
 */
export async function GET(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return createUnauthorizedResponse(
        'Invalid or missing authentication token.',
        'invalid_token'
      )
    }
    const user = ctx.user;
    const projectId = parseInt(params.projectId, 10)
    if (isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'project_id must be a positive integer',
          details: { field: 'project_id', code: 'invalid_format' },
        },
        { status: 400 }
      )
    }

    const access = await validateProjectAccess(projectId, user.id, ctx.agentId)
    if (access.error) {
      return NextResponse.json(
        { success: false, error: access.error.message },
        { status: access.error.status }
      )
    }

    const labels = await prisma.label.findMany({
      where: { projectId },
      select: { id: true, value: true },
      orderBy: { value: 'asc' },
    })

    return NextResponse.json({
      success: true,
      projectId,
      labels: labels.map((label) => ({ id: label.id, name: label.value || '' })),
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list labels',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/mcp/projects/:projectId/labels
 *
 * Creates a new label in a project.
 * Required for CLI and MCP create_label tool.
 *
 * Request body:
 * - name: string (required, 1-100 chars)
 *
 * Auth: MCP JWT (Bearer token)
 */
export async function POST(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return createUnauthorizedResponse(
        'Invalid or missing authentication token.',
        'invalid_token'
      )
    }
    const user = ctx.user;
    const projectId = parseInt(params.projectId, 10)
    if (isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'project_id must be a positive integer',
          details: { field: 'project_id', code: 'invalid_format' },
        },
        { status: 400 }
      )
    }

    const access = await validateProjectAccess(projectId, user.id, ctx.agentId)
    if (access.error) {
      return NextResponse.json(
        {
          success: false,
          error: access.error.message,
        },
        { status: access.error.status }
      )
    }

    const parsedBody = await readJsonBody<{ name?: unknown }>(request)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body
    const { name } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'name is required and must be a non-empty string',
          details: { field: 'name', code: 'missing_field' },
        },
        { status: 400 }
      )
    }

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'name must not be empty',
          details: { field: 'name', code: 'invalid_value' },
        },
        { status: 400 }
      )
    }

    if (trimmedName.length > 100) {
      return NextResponse.json(
        {
          success: false,
          error: 'name must not exceed 100 characters',
          details: { field: 'name', code: 'max_length_exceeded' },
        },
        { status: 400 }
      )
    }

    const existing = await prisma.label.findFirst({
      where: {
        projectId,
        value: trimmedName,
      },
    })

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: `Label "${trimmedName}" already exists in this project`,
          details: { field: 'name', code: 'duplicate' },
        },
        { status: 400 }
      )
    }

    const label = await prisma.label.create({
      data: {
        value: trimmedName,
        projectId,
      },
    })

    void broadcastBoardChange(projectId, { originUserId: user.id })

    return NextResponse.json(
      {
        success: true,
        label: {
          id: label.id,
          name: label.value || trimmedName,
        },
        message: `Label "${trimmedName}" created successfully`,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[MCP Create Label] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
