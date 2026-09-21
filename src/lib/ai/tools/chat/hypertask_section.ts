import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskSectionTool(context: ChatToolContext) {
  const { assertAccessibleProject, broadcastBoardChange, bulkPreviewsIssued, confirmationSessionId, createSection, deleteSection, prisma, requireCrossMessageConfirmation, sanitizeForJson, sendStatus, tool, updateSection, user, withToolErrors, z } = context;
  return tool({
      description:
        "List, create, rename, or delete sections/columns for a project. Defaults to listing sections.",
      inputSchema: z.object({
        action: z.enum(["list", "create", "rename", "delete"]).default("list"),
        project_id: z.coerce.number().int().positive(),
        include_hidden: z.boolean().default(false),
        section_id: z.coerce.number().int().positive().optional(),
        title: z.string().max(200).optional(),
        after_section_id: z.coerce.number().int().positive().optional(),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true only after the user explicitly confirms deleting this non-empty section and moving its tasks."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_section");
        if (input.action === "create") {
          const title = input.title?.trim();
          if (!title) {
            return { success: false, error: "title is required to create a section" };
          }
          const result = await createSection({
            projectId: input.project_id,
            title,
            userId: user.id,
            afterSectionId: input.after_section_id,
          });
          if (!result.success) {
            return {
              success: false,
              error: result.message || result.error,
            };
          }
          const taskCount = await prisma.task.count({
            where: {
              projectId: input.project_id,
              section: result.section.section_title,
              status: "Normal",
            },
          });
          void broadcastBoardChange(input.project_id, { originUserId: user.id });
          return sanitizeForJson({
            success: true,
            section: { ...result.section, taskCount },
            message: "Section created successfully",
          });
        }

        if (input.action === "rename") {
          if (!input.section_id) {
            return { success: false, error: "section_id is required to rename a section" };
          }
          const title = input.title?.trim();
          if (!title) {
            return { success: false, error: "title is required to rename a section" };
          }
          const result = await updateSection({
            projectId: input.project_id,
            sectionId: input.section_id,
            userId: user.id,
            title,
          });
          if (!result.success) {
            return {
              success: false,
              error: result.message || result.error,
            };
          }
          const taskCount = await prisma.task.count({
            where: {
              projectId: input.project_id,
              section: result.section.section_title,
              status: "Normal",
            },
          });
          void broadcastBoardChange(input.project_id, { originUserId: user.id });
          return sanitizeForJson({
            success: true,
            section: { ...result.section, taskCount },
            message: "Section updated successfully",
          });
        }

        if (input.action === "delete") {
          if (!input.section_id) {
            return { success: false, error: "section_id is required to delete a section" };
          }
          const hasAccess = await assertAccessibleProject(user.id, input.project_id);
          if (!hasAccess) {
            return { success: false, error: "Project not found or access denied" };
          }
          const section = await prisma.section.findFirst({
            where: {
              id: input.section_id,
              projectId: input.project_id,
              deleted: false,
            },
            select: { id: true, section_title: true },
          });
          if (!section) {
            return { success: false, error: "Section not found or access denied" };
          }
          const taskCount = await prisma.task.count({
            where: {
              projectId: input.project_id,
              OR: [
                { sectionId: section.id },
                { section: section.section_title },
              ],
              status: "Normal",
            },
          });
          if (taskCount > 0) {
            const operationKey = `delete-section:${input.project_id}:${section.id}`;
            const destination = await prisma.section.findFirst({
              where: {
                projectId: input.project_id,
                deleted: false,
                id: { not: section.id },
              },
              select: { id: true, section_title: true },
              orderBy: { ranking: "asc" },
            });
            if (!destination) {
              return {
                success: false,
                error:
                  "Cannot delete the only section while it still contains tasks.",
              };
            }
            if (
              await requireCrossMessageConfirmation({
                userId: user.id,
                sessionId: confirmationSessionId,
                operationKey,
                confirmed: input.confirmed,
                previewsIssuedThisRequest: bulkPreviewsIssued,
              }) === "preview"
            ) {
              return sanitizeForJson({
                success: false,
                confirmation_required: true,
                section,
                task_count: taskCount,
                destination_section: destination,
                message:
                  `Deleting this section would move ${taskCount} tasks` +
                  ` to "${destination.section_title}".` +
                  " Nothing has been changed yet. Ask the user to confirm, then call this tool in a new message with confirmed: true.",
              });
            }
          }
          const result = await deleteSection({
            projectId: input.project_id,
            sectionId: input.section_id,
            userId: user.id,
          });
          if (!result.success) {
            return {
              success: false,
              error: result.message || result.error,
            };
          }
          void broadcastBoardChange(input.project_id, { originUserId: user.id });
          return sanitizeForJson({
            success: true,
            message: result.message,
            moved_task_count: result.movedTaskCount,
            destination_section: result.destinationSection,
          });
        }

        const hasAccess = await assertAccessibleProject(user.id, input.project_id);
        if (!hasAccess) {
          return { success: false, error: "Project not found or access denied" };
        }

        const sections = await prisma.section.findMany({
          where: {
            projectId: input.project_id,
            deleted: false,
            ...(input.include_hidden ? {} : { visibility: true }),
          },
          select: {
            id: true,
            section_title: true,
            projectId: true,
            visibility: true,
            deleted: true,
            ranking: true,
          },
          orderBy: { ranking: "asc" },
        });

        const sectionList = await Promise.all(
          sections.map(async (section) => ({
            id: section.id,
            section_title: section.section_title,
            projectId: section.projectId,
            visibility: section.visibility,
            deleted: section.deleted,
            ranking: section.ranking,
            taskCount: await prisma.task.count({
              where: {
                projectId: input.project_id,
                section: section.section_title,
                status: "Normal",
              },
            }),
          }))
        );

        return sanitizeForJson({
          success: true,
          sections: sectionList,
          projectId: input.project_id,
        });
      }),
    });
}
