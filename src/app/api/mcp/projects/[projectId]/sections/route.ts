import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import prisma from '@/lib/prisma'
import { createSection } from '@/lib/mcp/sections/services'
import { broadcastBoardChange } from '@/lib/realtime/server'

export interface SectionListItem {
  id: number
  section_title: string
  projectId: number
  visibility: boolean
  deleted: boolean
  ranking: string
  /** Tickets here are finished. null means no explicit setting: fall back to the column name. */
  isDone: boolean | null
  /** Numeric user ID, agent UUID, or null when no auto-assignee is configured. */
  autoAssign: number | string | null
  taskCount: number
}

export interface ListSectionsResponse {
  success: boolean
  sections: SectionListItem[]
  projectId: number
}

export interface CreateSectionSuccessResponse {
  success: true
  section: SectionListItem
  message?: string
}

/**
 * POST /api/mcp/projects/:projectId/sections
 *
 * Creates a new section (column) in a project.
 *
 * Body Parameters:
 * - title: string (required) - The section/column name
 * - after_section_id: number (optional) - Place the new section after this section ID
 *
 * Authentication: Bearer token (JWT or API key) in Authorization header
 */
export async function POST(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
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
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while creating the section'
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/mcp/projects/:projectId/sections
 * 
 * Lists all sections for a specific project.
 * 
 * Query Parameters:
 * - include_hidden: Include hidden sections (default: false)
 * 
 * Authentication: Bearer token (JWT or API key) in Authorization header
 */
export async function GET(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  try {
    // Validate authentication
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

    // Verify user/agent has access to this active project only
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

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const includeHidden = searchParams.get('include_hidden') === 'true'

    // Build where clause
    const where: any = {
      projectId,
      deleted: false
    }

    // Filter hidden sections unless include_hidden is true
    if (!includeHidden) {
      where.visibility = true
    }

    // Get sections
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

    // Get task counts for each section
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

    const response: ListSectionsResponse = {
      success: true,
      sections: sectionList,
      projectId
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error listing sections:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
