import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard'
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit, readMcpRouteJsonBody as readJsonBody } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { SortingMode, SortingOrder, SubtaskSetting, EmptySections, ViewVisibility } from '@prisma/client'
import { savedViewBoardAccessWhere } from '@/utils/controllers/projects/getAllIncludes'
import { createView, ViewTitleConflictError, type CreateViewInput } from '@/lib/mcp/views/services'
import { validateProjectAccess } from '@/lib/mcp/tasks/services'
import { getViewUrl } from '@/utils/controllers/projects/views/viewsHelperAPIfunctions'
import { isSubtaskSetting } from '@/models/Views/model'
import { sanitizeBoardFilters, projectVisibleViewRelations } from '@/utils/helperFunctions/Views/BoardFilterSanitizer'


type CreateViewRequestBody = Partial<
  Pick<
    CreateViewInput,
    | 'visibility'
    | 'filters'
    | 'board_filters'
    | 'visible_section_ids'
    | 'sorting_mode'
    | 'sorting_order'
    | 'sorting_stack'
    | 'subtask_setting'
    | 'board_empty_sections'
  >
> & {
  project_id?: unknown
  projectId?: unknown
  title?: unknown
  set_as_default?: unknown
}

export interface ListViewItem {
  id: string
  title: string
  slug: string | null
  url: string | null
  visibility: ViewVisibility
  createdAt: Date
  lastUsedAt?: Date | null
  owner: {
    id: number
    email: string
    displayName?: string
  }
  project: {
    id: number
    name: string
    title?: string
  }
  is_default: boolean
  is_applied?: boolean
  board_sorting_mode?: SortingMode
  board_sorting_order?: SortingOrder
  board_sorting_stack?: unknown
  board_filters?: object
  board_columns_view?: object
  board_subtask_setting?: SubtaskSetting
  board_empty_sections?: EmptySections
}

export interface ListViewsResponse {
  success: boolean
  views: ListViewItem[]
  total: number
  limit: number
  offset: number
}

export interface CreateViewResponse {
  success: boolean
  view: Awaited<ReturnType<typeof createView>>
}

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    const user = ctx.user
    const searchParams = request.nextUrl.searchParams
    const rawProjectId = searchParams.get('projectId')
    const projectId = rawProjectId === null ? undefined : Number(rawProjectId)
    if (projectId !== undefined && (!/^\d+$/.test(rawProjectId!) || !Number.isSafeInteger(projectId) || projectId <= 0)) {
      return NextResponse.json({ success: false, error: 'Invalid projectId' }, { status: 400 })
    }
    const visibility = searchParams.get('visibility') as ViewVisibility | null || undefined
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0)
    const sortBy = searchParams.get('sort_by') || 'lastUsedAt'
    const sortOrder = (searchParams.get('sort_order') || 'desc') as 'asc' | 'desc'
    const includeSettings = searchParams.get('include_settings') === 'true'

    const orderBy: any =
      sortBy === 'title' ? { title: sortOrder }
      : sortBy === 'createdAt' ? { createdAt: sortOrder }
      : { lastUsedAt: sortOrder }

    const viewSelect = {
      id: true,
      userId: true,
      project_view_id: true,
      title: true,
      slug: true,
      visibility: true,
      createdAt: true,
      lastUsedAt: true,
      board_sorting_mode: true,
      board_sorting_order: true,
      board_sorting_stack: true,
      board_filters: true,
      board_columns_view: true,
      board_subtask_setting: true,
      board_empty_sections: true,
      owner: { select: { id: true, email: true, displayName: true } },
      ViewLastUsed: {
        where: { userId: user.id },
        select: { lastUsedAt: true },
        take: 1,
      },
    } as const

    let viewList: ListViewItem[]
    let total: number

    if (projectId !== undefined) {
      const board = await prisma.project.findFirst({
        where: { id: projectId, ...savedViewBoardAccessWhere(user.id, ctx.agentId, ctx.teamScope) },
        select: { id: true },
      })
      if (!board) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 })
      const viewWhere: any = {
        project_view: { projectId, project: savedViewBoardAccessWhere(user.id, ctx.agentId, ctx.teamScope) },
        OR: [
          { visibility: 'Public' },
          { visibility: 'Private', userId: user.id },
        ],
        ...(visibility ? { visibility } : {}),
      }

      const [count, views] = await Promise.all([
        prisma.view.count({ where: viewWhere }),
        prisma.view.findMany({
          where: viewWhere,
          select: {
            ...viewSelect,
            project_view: {
              select: {
                default_view_id: true,
                user_project_views: {
                  where: { userId: user.id },
                  select: { appliedViewId: true },
                  take: 1,
                },
                project: { select: { id: true, name: true, title: true } },
              },
            },
          },
          orderBy,
          take: limit,
          skip: offset,
        }),
      ])

      total = count
      viewList = views.map(v => {
        const appliedViewId = v.project_view.user_project_views[0]?.appliedViewId
          ?? v.project_view.default_view_id
        return toViewItem(v, v.project_view, includeSettings, appliedViewId)
      })
    } else {
      const userProjects = await prisma.project.findMany({
        where: { status: 'Normal', ...savedViewBoardAccessWhere(user.id, ctx.agentId, ctx.teamScope) },
        select: { id: true },
      })
      const projectIds = userProjects.map(p => p.id)

      if (projectIds.length === 0) {
        return NextResponse.json({
          success: true, views: [], total: 0, limit, offset,
        } satisfies ListViewsResponse)
      }

      const allProjectViews = await prisma.project_View.findMany({
        where: { projectId: { in: projectIds } },
        select: {
          id: true,
          default_view_id: true,
          default_view: { select: viewSelect },
          user_project_views: {
            where: { userId: user.id },
            select: { appliedView: { select: viewSelect } },
            take: 1,
          },
          project: { select: { id: true, name: true, title: true } },
        },
      })

      const allResolved = allProjectViews.flatMap(raw => {
        const pv = projectVisibleViewRelations(raw, user.id)
        const appliedView = pv.user_project_views[0]?.appliedView ?? null
        const defaultView = pv.default_view

        let view: typeof defaultView = appliedView ?? defaultView
        if (visibility && view?.visibility !== visibility) {
          view = defaultView?.visibility === visibility ? defaultView : null
        }

        if (!view) return []
        return [toViewItem(
          view,
          { default_view_id: pv.default_view_id, project: pv.project },
          includeSettings,
          view.id,
        )]
      })

      total = allResolved.length
      viewList = allResolved.slice(offset, offset + limit)
    }

    return NextResponse.json({
      success: true,
      views: viewList,
      total,
      limit,
      offset,
    } satisfies ListViewsResponse)
  } catch (error) {
    console.error('Error listing views:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }

  })(request)
}

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }
    const roleRefusal = await requireAgentWriteRole(ctx)
    if (roleRefusal) return roleRefusal

    const user = ctx.user
    const parsedBody = await readJsonBody<CreateViewRequestBody>(request)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body
    const projectId = Number(body.project_id ?? body.projectId)
    const title = typeof body.title === 'string' ? body.title.trim() : ''

    if (!projectId || !title) {
      return NextResponse.json(
        { success: false, error: 'project_id and title are required' },
        { status: 400 }
      )
    }

    if (body.filters !== undefined && body.board_filters !== undefined) {
      return NextResponse.json(
        { success: false, error: 'Use either filters or board_filters, not both' },
        { status: 400 }
      )
    }

    if (body.subtask_setting !== undefined && !isSubtaskSetting(body.subtask_setting)) {
      return NextResponse.json(
        {
          success: false,
          error: 'subtask_setting must be None, Parent, Flattened, Card, or Flattened_Card',
        },
        { status: 400 }
      )
    }
    if (body.set_as_default !== undefined && typeof body.set_as_default !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'set_as_default must be a boolean' },
        { status: 400 }
      )
    }

    const access = await validateProjectAccess(projectId, user.id, ctx.agentId, ctx.teamScope)
    if (access.error) {
      return NextResponse.json(
        { success: false, error: access.error.message },
        { status: access.error.status }
      )
    }

    const view = await createView({
      agentId: ctx.agentId, teamScope: ctx.teamScope,
      projectId,
      userId: user.id,
      title,
      visibility: body.visibility,
      filters: body.filters,
      board_filters: body.board_filters,
      visible_section_ids: body.visible_section_ids,
      sorting_mode: body.sorting_mode,
      sorting_order: body.sorting_order,
      sorting_stack: body.sorting_stack,
      subtask_setting: body.subtask_setting,
      board_empty_sections: body.board_empty_sections,
      setAsDefault: body.set_as_default ?? false,
    })

    return NextResponse.json({ success: true, view })
  } catch (error) {
    if (!(error instanceof ViewTitleConflictError)) console.error('Error creating view:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 400 }
    )
  }

  })(request)
}


function toViewItem(
  v: {
    id: string
    title: string | null
    slug: string | null
    visibility: ViewVisibility
    createdAt: Date
    lastUsedAt: Date | null
    board_sorting_mode: SortingMode
    board_sorting_order: SortingOrder
    board_sorting_stack: unknown
    board_filters: unknown
    board_columns_view: unknown
    board_subtask_setting: SubtaskSetting
    board_empty_sections: EmptySections
    owner: { id: number; email: string; displayName: string | null }
    ViewLastUsed: { lastUsedAt: Date | null }[]
  },
  pv: {
    default_view_id: string | null | undefined
    project: { id: number; name: string; title: string | null }
  },
  includeSettings = false,
  appliedViewId?: string | null,
): ListViewItem {
  const item: ListViewItem = {
    id: v.id,
    title: v.title || '',
    slug: v.slug,
    url: v.slug ? getViewUrl(pv.project.id, v.slug) : null,
    visibility: v.visibility,
    createdAt: v.createdAt,
    lastUsedAt: v.ViewLastUsed[0]?.lastUsedAt ?? v.lastUsedAt,
    owner: {
      id: v.owner.id,
      email: v.owner.email,
      displayName: v.owner.displayName || undefined,
    },
    project: {
      id: pv.project.id,
      name: pv.project.name,
      title: pv.project.title || undefined,
    },
    is_default: pv.default_view_id === v.id,
  }

  if (includeSettings) {
    item.is_applied = appliedViewId === v.id
    item.board_sorting_mode = v.board_sorting_mode
    item.board_sorting_order = v.board_sorting_order
    item.board_sorting_stack = v.board_sorting_stack
    item.board_filters = sanitizeBoardFilters(v.board_filters) as object
    item.board_columns_view = v.board_columns_view as object
    item.board_subtask_setting = v.board_subtask_setting
    item.board_empty_sections = v.board_empty_sections
  }

  return item
}
