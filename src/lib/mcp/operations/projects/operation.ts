import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'

import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'
import prisma from '@/lib/prisma'
import {
  normalizeTaskStatus,
  parseNumericCursor,
  projectRows,
} from '@/lib/mcp/listQuery'
import { readListQuery } from '@/lib/mcp/readListQuery'

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

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
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
    const searchParams = request.nextUrl.searchParams

    const parsedListQuery = readListQuery(searchParams)
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
    const limit = Math.min(listQuery?.limit ?? parseInt(searchParams.get('limit') || '50'), 100)
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

    if (sortBy !== 'title' && sortBy !== 'createdAt') {
      return NextResponse.json(
        { success: false, error: 'Validation error', message: 'sort must be title or createdAt; boards do not track update times' },
        { status: 400 },
      )
    }
    if (sortOrder !== 'asc' && sortOrder !== 'desc') {
      return NextResponse.json(
        { success: false, error: 'Validation error', message: 'sort_order must be asc or desc' },
        { status: 400 },
      )
    }
    if (listQuery?.filter.updated_since) {
      return NextResponse.json(
        { success: false, error: 'Validation error', message: 'filter.updated_since is not supported; boards do not track update times' },
        { status: 400 },
      )
    }

    const where: Prisma.ProjectWhereInput = {
      status: status ?? 'Normal',
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          } satisfies Prisma.ProjectWhereInput
        : {}),
    }
    const orderBy: Prisma.ProjectOrderByWithRelationInput = { [sortBy]: sortOrder }

    const total = await prisma.project.count({
      where: { ...where, AND: [getProjectListingWhere(user.id, ctx.agentId, ctx.teamScope)] },
    })

    const projects = await prisma.project.findMany({
      where: { ...where, AND: [getProjectListingWhere(user.id, ctx.agentId, ctx.teamScope)] },
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

    projects.forEach(project => recordAgentBoardScopeMiss(project.id, "read"));
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
      nextCursor: projects.length === limit ? String(projects[projects.length - 1].id) : null,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error listing projects:', error)
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
