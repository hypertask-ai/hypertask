import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskListViewsTool(context: ChatToolContext) {
  const { assertAccessibleProject, getProjectWhere, mapViewToResponse, prisma, sanitizeForJson, sendStatus, sortOrderSchema, tool, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description:
        "List accessible board views, list views for one project, or get one view by id. Returns each view's id, slug, title, and shareable url.",
      inputSchema: z.object({
        view_id: z.string().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        visibility: z.enum(["Public", "Private"]).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort_by: z.enum(["title", "createdAt", "lastUsedAt"]).default("lastUsedAt"),
        sort_order: sortOrderSchema.default("desc"),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_views");

        const viewSelect = {
          id: true,
          title: true,
          slug: true,
          visibility: true,
          board_sorting_stack: true,
          createdAt: true,
          lastUsedAt: true,
          owner: { select: { id: true, email: true, displayName: true } },
          ViewLastUsed: {
            where: { userId: user.id },
            select: { lastUsedAt: true },
            take: 1,
          },
        } as const;

        if (input.view_id) {
          const view = await prisma.view.findFirst({
            where: { id: input.view_id },
            select: {
              ...viewSelect,
              slug: true,
              board_sorting_mode: true,
              board_sorting_order: true,
              board_filters: true,
              board_columns_view: true,
              board_subtask_setting: true,
              board_empty_sections: true,
              project_view_id: true,
              project_view: {
                select: {
                  default_view_id: true,
                  project: { select: { id: true, name: true, title: true } },
                },
              },
            },
          });

          if (!view) {
            return { success: false, error: "View does not exist" };
          }

          const hasAccess = await assertAccessibleProject(
            user.id,
            view.project_view.project.id
          );
          if (!hasAccess) {
            return {
              success: false,
              error: "User does not have access to project this view belongs to",
            };
          }

          if (view.owner.id !== user.id && view.visibility === "Private") {
            return {
              success: false,
              error: "Cannot access another user's private view",
            };
          }

          return sanitizeForJson({
            success: true,
            view: mapViewToResponse(view, view.project_view, true),
          });
        }

        const orderBy: Prisma.ViewOrderByWithRelationInput =
          input.sort_by === "title"
            ? { title: input.sort_order }
            : input.sort_by === "createdAt"
              ? { createdAt: input.sort_order }
              : { lastUsedAt: input.sort_order };

        if (input.project_id) {
          const access = await validateProjectAccess(input.project_id, user.id);
          if (access.error) {
            return { success: false, error: access.error.message };
          }

          const viewWhere: Prisma.ViewWhereInput = {
            project_view: { projectId: input.project_id },
            OR: [
              { visibility: "Public" },
              { visibility: "Private", userId: user.id },
            ],
            ...(input.visibility ? { visibility: input.visibility } : {}),
          };

          const [total, views] = await Promise.all([
            prisma.view.count({ where: viewWhere }),
            prisma.view.findMany({
              where: viewWhere,
              select: {
                ...viewSelect,
                project_view: {
                  select: {
                    default_view_id: true,
                    project: { select: { id: true, name: true, title: true } },
                  },
                },
              },
              orderBy,
              take: input.limit,
              skip: input.offset,
            }),
          ]);

          return sanitizeForJson({
            success: true,
            views: views.map((view) => mapViewToResponse(view, view.project_view)),
            total,
            limit: input.limit,
            offset: input.offset,
          });
        }

        const userProjects = await prisma.project.findMany({
          where: { status: "Normal", ...getProjectWhere(user.id) },
          select: { id: true },
        });
        const projectIds = userProjects.map((project) => project.id);

        if (projectIds.length === 0) {
          return sanitizeForJson({
            success: true,
            views: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
          });
        }

        const allProjectViews = await prisma.project_View.findMany({
          where: { projectId: { in: projectIds } },
          select: {
            default_view_id: true,
            default_view: { select: viewSelect },
            user_project_views: {
              where: { userId: user.id },
              select: { appliedView: { select: viewSelect } },
              take: 1,
            },
            project: { select: { id: true, name: true, title: true } },
          },
        });

        const allResolved = allProjectViews.flatMap((projectView) => {
          const appliedView =
            projectView.user_project_views[0]?.appliedView ?? null;
          const defaultView = projectView.default_view;
          let view = appliedView ?? defaultView;

          if (input.visibility && view?.visibility !== input.visibility) {
            view =
              defaultView?.visibility === input.visibility ? defaultView : null;
          }

          if (!view) return [];
          return [
            mapViewToResponse(view, {
              default_view_id: projectView.default_view_id,
              project: projectView.project,
            }),
          ];
        });

        const views = allResolved.slice(input.offset, input.offset + input.limit);

        return sanitizeForJson({
          success: true,
          views,
          total: allResolved.length,
          limit: input.limit,
          offset: input.offset,
        });
      }),
    });
}
