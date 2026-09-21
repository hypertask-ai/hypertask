import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskGetViewTool(context: ChatToolContext) {
  const { assertAccessibleProject, getViewUrl, prisma, sanitizeBoardFilters, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Get one saved board view and its filters, sorting, and visibility. Returns the view's id, slug, title, and shareable url.",
      inputSchema: z.object({
        viewId: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_view");
        const view = await prisma.view.findFirst({
          where: { id: input.viewId },
          select: {
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
            owner: {
              select: { id: true, email: true, displayName: true },
            },
            ViewLastUsed: {
              where: { userId: user.id },
              select: { lastUsedAt: true },
              take: 1,
            },
            project_view: {
              select: {
                default_view_id: true,
                project: {
                  select: { id: true, name: true, title: true },
                },
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
          view: {
            id: view.id,
            title: view.title || "",
            slug: view.slug,
            url: view.slug
              ? getViewUrl(view.project_view.project.id, view.slug)
              : null,
            visibility: view.visibility,
            createdAt: view.createdAt,
            lastUsedAt: view.ViewLastUsed[0]?.lastUsedAt ?? view.lastUsedAt,
            owner: {
              id: view.owner.id,
              email: view.owner.email,
              displayName: view.owner.displayName || undefined,
            },
            board_sorting_mode: view.board_sorting_mode,
            board_sorting_order: view.board_sorting_order,
            board_sorting_stack: view.board_sorting_stack,
            board_filters: sanitizeBoardFilters(view.board_filters) || undefined,
            board_columns_view: view.board_columns_view || undefined,
            board_subtask_setting: view.board_subtask_setting,
            board_empty_sections: view.board_empty_sections,
            project: {
              id: view.project_view.project.id,
              name: view.project_view.project.name,
              title: view.project_view.project.title || undefined,
            },
            is_default: view.project_view.default_view_id === view.id,
          },
        });
      }),
    });
}
