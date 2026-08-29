import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { columnRoleFor } from '@/lib/mcp/boards/columnRole'
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

/**
 * GET /api/mcp/projects/:projectId/manifest
 *
 * Returns the authenticated user's read-only view of a board's column structure.
 */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  const params = await props.params

  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.'
        },
        { status: 401 }
      )
    }

    const projectId = parseInt(params.projectId)
    if (isNaN(projectId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid project ID'
        },
        { status: 400 }
      )
    }

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: 'Normal',
        ...getProjectWhere(ctx.user.id, ctx.agentId),
      },
      select: {
        id: true,
        title: true,
        section: {
          where: {
            deleted: false,
            visibility: true,
          },
          select: {
            id: true,
            section_title: true,
            isDone: true,
            ranking: true,
          },
          orderBy: {
            ranking: 'asc',
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json(
        {
          success: false,
          error: 'Project not found or access denied'
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      projectId: project.id,
      boardTitle: project.title || '',
      columns: project.section.map((section) => ({
        id: section.id,
        title: section.section_title,
        position: section.ranking,
        role: columnRoleFor(section),
        wipLimit: null,
      })),
      transitions: 'any',
    })
  } catch (error) {
    console.error('Error getting board manifest:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
