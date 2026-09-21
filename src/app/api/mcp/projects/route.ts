import { logger as htLogger } from "#logger";
import { withoutAuth } from "#with-auth";
import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'
import prisma from '@/lib/prisma'
import { HTPR_6530_MCP_LIST_QUERY_FLAG, isFeatureEnabled } from '@/lib/flags'
import {
  normalizeTaskStatus,
  parseNumericCursor,
  parseUpdatedSince,
  projectRows,
} from '@/lib/mcp/listQuery'
import { readEnabledListQuery } from '@/lib/mcp/readListQuery'

export interface ProjectLabel {
  id: string
  name: string
  color?: string
}

export interface ProjectListItem {
  id: number
  title: string
  description?: string
  name: string
  uniqueIdentifier?: string
  ownerId: number
  owner?: {
    id: number
    email: string
    displayName?: string
  }
  memberCount: number
  taskCount: number
  defaultSections: string[]
  sections: { id: number; section_title: string }[]
  labels: ProjectLabel[]
  status: 'Normal' | 'Archive' | 'Deleted'
  createdAt: string
}

export interface ListProjectsResponse {
  success: boolean
  projects: ProjectListItem[]
  total: number
  limit: number
  offset: number
  nextCursor?: string | null
}

/**
 * GET /api/mcp/projects
 * 
 * Lists all projects the authenticated user has access to.
 * 
 * Query Parameters:
 * - status: Filter by status ('Normal', 'Archive', 'Deleted')
 * - search: Search term for project title/name
 * - limit: Maximum number of results (default: 50)
 * - offset: Number of results to skip (default: 0)
 * - sort_by: Field to sort by ('title', 'createdAt', 'updatedAt')
 * - sort_order: Sort order ('asc' or 'desc', default: 'asc')
 * 
 * Authentication: Bearer token (JWT or API key) in Authorization header
 */
async function GETHandler(request: NextRequest) {
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
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const listQueryEnabled = await isFeatureEnabled(HTPR_6530_MCP_LIST_QUERY_FLAG, user.id)
    const parsedListQuery = readEnabledListQuery(listQueryEnabled, searchParams)
    if (parsedListQuery.error) return parsedListQuery.error
    const listQuery = parsedListQuery.listQuery
    const rawStatus = listQuery?.filter.status ?? searchParams.get('status')
    const status = rawStatus ? normalizeTaskStatus(rawStatus) : null
    if (rawStatus && !status) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'filter.status must be open, Normal, Archive, or Deleted',
        },
        { status: 400 },
      )
    }
    const search = listQuery?.query || searchParams.get('search') || undefined
    const limit = Math.min(listQuery?.limit ?? parseInt(searchParams.get('limit') || '50'), 100) // Max 100
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0)
    const sortBy = listQuery?.sortBy || searchParams.get('sort_by') || 'title'
    const sortOrder = listQuery?.sortOrder || searchParams.get('sort_order') || 'asc'
    const cursorId = listQuery?.cursor ? parseNumericCursor(listQuery.cursor) : null
    if (listQuery?.cursor && cursorId === null) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'cursor must be a previous nextCursor value',
        },
        { status: 400 },
      )
    }

    const where: any = {
      status: status ?? 'Normal',
      AND: [
        getProjectListingWhere(user.id, ctx.agentId),
        ...(search
          ? [
              {
                OR: [
                  { title: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                ],
              },
            ]
          : []),
      ],
    }
    if (listQuery?.filter.updated_since) {
      const since = parseUpdatedSince(listQuery.filter.updated_since)
      if (!since) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation error',
            message: 'filter.updated_since must be an ISO datetime',
          },
          { status: 400 },
        )
      }
      where.updatedAt = { gte: since }
    }

    // Build orderBy
    const orderBy: any = {}
    if (sortBy === 'title') {
      orderBy.title = sortOrder
    } else if (sortBy === 'createdAt') {
      orderBy.createdAt = sortOrder
    } else if (sortBy === 'updatedAt') {
      orderBy.updatedAt = sortOrder
    } else {
      orderBy.title = 'asc' // Default
    }

    // Get total count
    const total = await prisma.project.count({ where })

    // Get projects with pagination
    const projects = await prisma.project.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        name: true,
        uniqueIdentifier: true,
        ownerId: true,
        owner: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        },
        status: true,
        sections: true,
        section: {
          select: {
            id: true,
            section_title: true
          }
        },
        labels: {
          select: {
            id: true,
            value: true
          }
        },
        createdAt: true,
        _count: {
          select: {
            members: true,
            tasks: {
              where: {
                status: 'Normal'
              }
            }
          }
        }
      },
      orderBy: [orderBy, { id: 'asc' as const }],
      take: limit,
      skip: cursorId ? 1 : offset,
      ...(cursorId ? { cursor: { id: cursorId } } : {}),
    })

    // Transform to response format
    const projectList: ProjectListItem[] = projects.map(project => ({
      id: project.id,
      title: project.title || '',
      description: project.description || undefined,
      name: project.name,
      uniqueIdentifier: project.uniqueIdentifier || undefined,
      ownerId: project.ownerId,
      owner: project.owner ? {
        id: project.owner.id,
        email: project.owner.email,
        displayName: project.owner.displayName || undefined
      } : undefined,
      memberCount: project._count.members,
      taskCount: project._count.tasks,
      defaultSections: project.sections || [],
      sections: project.section,
      labels: (project.labels || []).map(l => ({
        id: l.id,
        name: l.value || ''
      })),
      status: project.status,
      createdAt: project.createdAt.toISOString(),
    }))

    const response: ListProjectsResponse = {
      success: true,
      projects: (listQuery?.fields.length
        // @ts-expect-error ProjectListItem has no string index signature
        ? projectRows(projectList as Array<Record<string, unknown>>, listQuery.fields)
        : projectList) as ProjectListItem[],
      total,
      limit,
      offset: cursorId ? 0 : offset,
      ...(listQueryEnabled
        ? { nextCursor: projects.length === limit ? String(projects[projects.length - 1].id) : null }
        : {}),
    }

    return NextResponse.json(response)
  } catch (error) {
    htLogger.error('Error listing projects:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}

export const GET = withoutAuth(GETHandler);
