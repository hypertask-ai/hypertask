import { tool } from "ai";
import { z } from "zod";
import { getPage } from "@/utils/controllers/pages/pageService";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { htmlToMarkdown } from "@/utils/controllers/pages/htmlToMarkdown";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createGetPageTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_get_page: tool({
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
    }),
  };
}
