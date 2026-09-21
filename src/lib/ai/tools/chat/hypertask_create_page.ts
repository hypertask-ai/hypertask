import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskCreatePageTool(context: ChatToolContext) {
  const { actingAgentId, createPage, getPageUrl, prisma, sanitizeForJson, sendStatus, tool, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description:
        "Create a long-form page attached to a Hypertask task. Content is treated as Markdown by default, or can be supplied as HTML.",
      inputSchema: z.object({
        task_id: z.coerce.number().int().positive(),
        title: z.string().max(500).optional(),
        content: z.string(),
        content_type: z.enum(["markdown", "html"]).optional(),
        parent_page_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_page");
        const task = await prisma.task.findUnique({
          where: { id: input.task_id },
          select: { projectId: true },
        });
        if (!task) {
          return { success: false, error: "Task not found" };
        }

        const access = await validateProjectAccess(task.projectId, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const page = await createPage({
          taskId: input.task_id,
          title: input.title,
          content: input.content,
          contentType: input.content_type ?? "markdown",
          parentPageId: input.parent_page_id,
          userId: user.id,
          agentId: actingAgentId,
        });

        return sanitizeForJson({
          success: true,
          page: {
            publicId: page.publicId,
            id: page.id,
            title: page.title,
            version: page.version,
            url: getPageUrl(page.publicId),
          },
        });
      }),
    });
}
