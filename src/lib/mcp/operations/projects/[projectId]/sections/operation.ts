import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import prisma from '@/lib/prisma'
import { createSection } from '@/lib/mcp/sections/services'
import { broadcastBoardChange } from '@/lib/realtime/server'
import { readListQuery, tryApplyCollectionQuery } from '@/lib/mcp/readListQuery'

export interface SectionListItem {
  id: number
  section_title: string
  projectId: number
  visibility: boolean
  deleted: boolean
  ranking: string
  isDone: boolean | null
  autoAssign: number | string | null
  taskCount: number
}

export interface ListSectionsResponse {
  success: boolean
  sections: SectionListItem[]
  projectId: number
  nextCursor?: string | null
}

export interface CreateSectionSuccessResponse {
  success: true
  section: SectionListItem
  message?: string
}

export async function POST(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication error',
          message: 'Invalid or expired JWT token'
        },
        { status: 401 }
      )
    }
    const user = ctx.user;
    const projectId = parseInt(params.projectId)

    if (isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'projectId must be a positive integer',
          details: { field: 'projectId', code: 'invalid_format' }
        },
        { status: 400 }
      )
    }

    let body: { title?: string; after_section_id?: number }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'Invalid request body',
          details: { field: 'body', code: 'invalid_json' }
        },
        { status: 400 }
      )
    }

    const title = typeof body?.title === 'string' ? body.title.trim() : ''

    if (!title) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'Missing required field: title',
          details: { field: 'title', code: 'missing' }
        },
        { status: 400 }
      )
    }

    if (title.length > 200) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'title must be between 1 and 200 characters',
          details: { field: 'title', code: 'invalid_length' }
        },
        { status: 400 }
      )
    }

    const afterSectionId = body?.after_section_id != null
      ? parseInt(String(body.after_section_id))
      : undefined

    if (afterSectionId != null && (isNaN(afterSectionId) || afterSectionId <= 0)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'after_section_id must be a positive integer',
          details: { field: 'after_section_id', code: 'invalid_type' }
        },
        { status: 400 }
      )
    }

    const result = await createSection(
      {
        projectId,
        title,
        userId: user.id,
        afterSectionId,
      },
      ctx.agentId
    )

    if (!result.success) {
      const errorPayload: Record<string, unknown> = {
        success: false,
        error: result.error
      }
      if (result.message) errorPayload.message = result.message
      if (result.details) errorPayload.details = result.details
      return NextResponse.json(errorPayload, { status: result.status })
    }

    const section = result.section
    const taskCount = await prisma.task.count({
      where: {
        projectId,
        section: section.section_title,
        status: 'Normal'
      }
    })

    void broadcastBoardChange(projectId, { originUserId: user.id })

    return NextResponse.json(
      {
        success: true,
        section: {
          id: section.id,
          section_title: section.section_title,
          projectId: section.projectId,
          visibility: section.visibility,
          deleted: section.deleted,
          ranking: section.ranking,
          isDone: section.isDone ?? null,
          autoAssign: null,
          taskCount
        },
        message: 'Section created successfully'
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error creating section:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while creating the section'
      },
      { status: 500 }
    )
  }

  })(request)
}

export async function GET(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const params = await props.params;
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
    const user = ctx.user;
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
        ...getProjectWhere(user.id, ctx.agentId),
      },
      select: {
        id: true
      }
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

    const searchParams = request.nextUrl.searchParams
    const includeHidden = searchParams.get('include_hidden') === 'true'

    const parsedListQuery = readListQuery(searchParams)
    if (parsedListQuery.error) return parsedListQuery.error
    const listQuery = parsedListQuery.listQuery

    const where: any = {
      projectId,
      deleted: false
    }

    if (!includeHidden) {
      where.visibility = true
    }

    const sections = await prisma.section.findMany({
      where,
      select: {
        id: true,
        section_title: true,
        projectId: true,
        visibility: true,
        deleted: true,
        ranking: true,
        isDone: true,
        autoAssignUserId: true,
        autoAssignAgentId: true
      },
      orderBy: {
        ranking: 'asc'
      }
    })

    const sectionList: SectionListItem[] = await Promise.all(
      sections.map(async (section) => {
        const taskCount = await prisma.task.count({
          where: {
            projectId: projectId,
            section: section.section_title,
            status: 'Normal'
          }
        })

        return {
          id: section.id,
          section_title: section.section_title,
          projectId: section.projectId,
          visibility: section.visibility,
          deleted: section.deleted,
          ranking: section.ranking,
          isDone: section.isDone,
          autoAssign: section.autoAssignAgentId ?? section.autoAssignUserId ?? null,
          taskCount
        }
      })
    )

    const projected = listQuery
      // @ts-expect-error SectionListItem has no string index signature
      ? tryApplyCollectionQuery(sectionList as Array<Record<string, unknown>>, listQuery, {
          searchFields: ['section_title'],
        })
      : null
    if (projected && !projected.ok) return projected.error
    const response: ListSectionsResponse = {
      success: true,
      sections: (projected?.value.items ?? sectionList) as SectionListItem[],
      projectId,
      nextCursor: projected?.value.nextCursor ?? null,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error listing sections:', error)
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
