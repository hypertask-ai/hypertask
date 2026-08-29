import { NextRequest, NextResponse } from "next/server";
import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import { deleteView, updateView } from "@/lib/mcp/views/services";
import prisma from "@/lib/prisma";
import {
  SortingMode,
  SortingOrder,
  SubtaskSetting,
  EmptySections,
  ViewVisibility,
} from "@prisma/client";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { ListViewItem } from "../route";
import { TBoardSortingLevel } from "@/models/Views/model";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { getViewUrl } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { isSubtaskSetting } from "@/models/Views/model";

export interface AppliedViewItem extends ListViewItem {
  board_sorting_mode: SortingMode;
  board_sorting_order: SortingOrder;
  board_sorting_stack?: TBoardSortingLevel[] | null;
  board_filters?: object;
  board_columns_view?: object;
  board_subtask_setting?: SubtaskSetting;
  board_empty_sections?: EmptySections;
}

export interface GetViewResponse {
  success: boolean;
  view: AppliedViewItem;
}

/**
 * GET /api/mcp/view
 *
 * - Params: viewId, returns the view the user requested.
 *
 * Authentication: Bearer token (JWT or API key) in Authorization header
 */
export async function GET(request: NextRequest, props: { params: Promise<{ viewId: string }> }) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);

    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized. Invalid or missing authentication token.",
        },
        { status: 401 },
      );
    }

    const user = ctx.user;

    const viewSelect = {
      id: true,
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
      project_view_id: true,
      owner: { select: { id: true, email: true, displayName: true } },
      ViewLastUsed: {
        where: { userId: user.id },
        select: { lastUsedAt: true },
        take: 1,
      },
    } as const;

    const view = await prisma.view.findFirst({
      where: {
        id: params.viewId,
      },
      select: {
        ...viewSelect,
        project_view: {
          select: {
            default_view_id: true,
            project: { select: { id: true, name: true, title: true } },
          },
        },
      },
    });

    if (!view)
      return NextResponse.json(
        { success: false, error: "View does not exist" },
        { status: 404 },
      );

    //We need to also make a safety check if user is able to see this view project wise, and visibility wise
    const userProjects = await prisma.project.findMany({
      where: { status: "Normal", ...getProjectWhere(user.id, ctx.agentId) },
      select: { id: true },
    });
    const projectIds = userProjects.map((p) => p.id);
    //Check here if user belongs to the project this view resides in
    if (!projectIds.includes(view.project_view.project.id))
      return NextResponse.json(
        {
          success: false,
          error: "User does not have access to project this view belongs to",
        },
        { status: 403 },
      );

    //Check if requested view belongs to either the user, or is public view in general. The user cannot access someone else's private view
    if (view.owner.id !== user.id && view.visibility === "Private")
      return NextResponse.json(
        {
          success: false,
          error:
            "Cannot access another user's private view",
        },
        { status: 403 },
      );

    const normalizedView = toViewItem(view, view.project_view);

    return NextResponse.json({
      success: true,
      view: normalizedView,
    } satisfies GetViewResponse);
  } catch (error) {
    console.error("Error getting views:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

function toViewItem(
  v: {
    id: string;
    title: string | null;
    slug: string | null;
    visibility: ViewVisibility;
    createdAt: Date;
    lastUsedAt: Date | null;
    board_sorting_mode: SortingMode;
    board_sorting_order: SortingOrder;
    board_sorting_stack: unknown;
    board_filters: unknown;
    board_columns_view: unknown;
    board_subtask_setting: SubtaskSetting;
    board_empty_sections: EmptySections;
    project_view_id: string;
    owner: { id: number; email: string; displayName: string | null };
    ViewLastUsed: { lastUsedAt: Date | null }[];
  },
  pv: {
    default_view_id: string | null | undefined;
    project: { id: number; name: string; title: string | null };
  },
): AppliedViewItem {
  return {
    id: v.id,
    title: v.title || "",
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
    board_sorting_mode: v.board_sorting_mode,
    board_sorting_order: v.board_sorting_order,
    board_sorting_stack: v.board_sorting_stack as TBoardSortingLevel[] | null,
    board_filters: sanitizeBoardFilters(v.board_filters) as object | undefined,
    board_columns_view: v.board_columns_view as object | undefined,
    board_subtask_setting: v.board_subtask_setting,
    board_empty_sections: v.board_empty_sections,
    project: {
      id: pv.project.id,
      name: pv.project.name,
      title: pv.project.title || undefined,
    },
    is_default: pv.default_view_id === v.id,
  };
}

/**
 * PATCH /api/mcp/view/[viewId] -- rename / re-filter / re-sort a saved board view.
 * Body (all optional): title, visibility ('Public'|'Private'), label_names[],
 * assignee_ids[], match ('ALL'|'ANY'), board_filters, visible_section_ids,
 * sorting_mode, sorting_order, sorting_stack, subtask_setting,
 * board_empty_sections, set_as_default.
 */
export async function PATCH(request: NextRequest, props: { params: Promise<{ viewId: string }> }) {
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
    const { viewId } = await props.params
    const body = await request.json().catch(() => ({}))
    const filtersProvided =
      body.label_names !== undefined ||
      body.assignee_ids !== undefined ||
      body.match !== undefined
    if (filtersProvided && body.board_filters !== undefined) {
      return NextResponse.json(
        { success: false, error: 'Use either label_names/assignee_ids/match or board_filters, not both' },
        { status: 400 }
      )
    }
    // match isn't a real Prisma enum column (it lives in the free-form
    // board_filters JSON blob), so an invalid value here would silently
    // persist instead of being rejected at the DB layer like visibility/
    // sorting_mode/sorting_order are.
    if (
      body.match !== undefined &&
      body.match !== 'ALL' &&
      body.match !== 'ANY'
    ) {
      return NextResponse.json(
        { success: false, error: "match must be 'ALL' or 'ANY'" },
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
    // Mirror POST /api/mcp/view (create): title, if provided, can't be blank.
    const title = body.title === undefined ? undefined : String(body.title).trim()
    if (title !== undefined && !title) {
      return NextResponse.json(
        { success: false, error: 'title cannot be empty' },
        { status: 400 }
      )
    }
    const updated = await updateView({
      viewId,
      userId: ctx.user.id,
      agentId: ctx.agentId,
      title,
      visibility: body.visibility,
      filters: filtersProvided
        ? { label_names: body.label_names, assignee_ids: body.assignee_ids, match: body.match }
        : undefined,
      board_filters: body.board_filters,
      visible_section_ids: body.visible_section_ids,
      sorting_mode: body.sorting_mode,
      sorting_order: body.sorting_order,
      sorting_stack: body.sorting_stack,
      subtask_setting: body.subtask_setting,
      board_empty_sections: body.board_empty_sections,
      setAsDefault: body.set_as_default,
    })
    return NextResponse.json({ success: true, view: updated })
  } catch (error) {
    console.error('Error updating view:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 400 }
    )
  }
}

/**
 * DELETE /api/mcp/view/[viewId] -- delete a saved board view.
 */
export async function DELETE(request: NextRequest, props: { params: Promise<{ viewId: string }> }) {
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
    const { viewId } = await props.params
    const deleted = await deleteView(viewId, ctx.user.id, ctx.agentId)
    return NextResponse.json({ success: true, view: deleted })
  } catch (error) {
    console.error('Error deleting view:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 400 }
    )
  }
}
