import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskGetPageTool(context: ChatToolContext) {
  const { getPage, htmlToMarkdown, sanitizeForJson, sendStatus, tool, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description:
        "Get a Hypertask page by numeric ID or public ID. Returns the page as Markdown by default, or as sanitized HTML when requested.",
      inputSchema: z.object({
        id: z.union([
          z.coerce.number().int().positive(),
          z.string(),
        ]),
        format: z.enum(["markdown", "html"]).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_page");
        const page = await getPage(
          typeof input.id === "number"
            ? { id: input.id }
            : { publicId: input.id }
        );
        if (!page) {
          return { success: false, error: "Page not found" };
        }

        const access = await validateProjectAccess(page.projectId, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const format = input.format ?? "markdown";
        return sanitizeForJson({
          success: true,
          page: {
            publicId: page.publicId,
            id: page.id,
            title: page.title,
            version: page.version,
            content:
              format === "html"
                ? page.contentHtml
                : htmlToMarkdown(page.contentHtml),
            content_type: format,
            task: {
              id: page.task.id,
              ticketNumber: page.task.ticketNumber,
              title: page.task.title,
              projectId: page.task.projectId,
              uniqueIndex: page.task.uniqueIndex,
            },
            subPages: page.subPages,
            updatedAt: page.updatedAt,
          },
        });
      }),
    });
}
