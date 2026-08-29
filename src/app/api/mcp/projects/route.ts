import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'
import prisma from '@/lib/prisma'

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
export async function GET(request: NextRequest) {
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
    const status = searchParams.get('status') as 'Normal' | 'Archive' | 'Deleted' | null
    const search = searchParams.get('search') || undefined
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100) // Max 100
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0)
    const sortBy = searchParams.get('sort_by') || 'title'
    const sortOrder = searchParams.get('sort_order') || 'asc'

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
      orderBy,
      take: limit,
      skip: offset,
   
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
      projects: projectList,
      total,
      limit,
      offset
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error listing projects:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
