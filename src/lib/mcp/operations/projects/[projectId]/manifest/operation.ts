import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import { getBoardHygiene } from '@/utils/controllers/projects/hygiene'
import { columnRoleFor } from '@/lib/mcp/boards/columnRole'
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
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
        ...getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope),
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
            wipLimit: true,
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
      ...(request.nextUrl.searchParams.get('include') === 'hygiene' ? {
        report: await getBoardHygiene(projectId, ctx.user.id, ctx.agentId, ctx.teamScope),
      } : {}),
      columns: project.section.map((section) => ({
        id: section.id,
        title: section.section_title,
        position: section.ranking,
        role: columnRoleFor(section),
        wipLimit: section.wipLimit,
      })),
      transitions: 'any',
    })
  } catch (error) {
    console.error('Error getting board manifest:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }

  })(request)
}
