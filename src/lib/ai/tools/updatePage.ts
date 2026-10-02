import { tool } from "ai";
import { z } from "zod";
import { getPage, updatePage, PageConflictError } from "@/utils/controllers/pages/pageService";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { getPageUrl } from "@/app/api/mcp/pages/_lib/routeUtils";
import { htmlToMarkdown } from "@/utils/controllers/pages/htmlToMarkdown";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createUpdatePageTool(context: ToolContext) {
  const { sendStatus, user, actingAgentId } = context;
  return {
    hypertask_update_page: tool({
      description:
        "Update a Hypertask page with Markdown content by default. Use mode=append or mode=prepend to extend it, and if_version for conflict-safe edits based on a previously read version.",
      inputSchema: z.object({
        id: z.union([
          z.coerce.number().int().positive(),
          z.string(),
        ]),
        content: z.string(),
        content_type: z.enum(["markdown", "html"]).optional(),
        mode: z.enum(["replace", "append", "prepend"]).optional(),
        if_version: z.coerce.number().int().positive().optional(),
        note: z.string().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_page");
        const existingPage = await getPage(
          typeof input.id === "number"
            ? { id: input.id }
            : { publicId: input.id }
        );
        if (!existingPage) {
          return { success: false, error: "Page not found" };
        }

        const access = await validateProjectAccess(
          existingPage.projectId,
          user.id
        );
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        try {
          const page = await updatePage({
            id: existingPage.id,
            content: input.content,
            contentType: input.content_type ?? "markdown",
            mode: input.mode,
            ifVersion: input.if_version,
            note: input.note,
            userId: user.id,
            agentId: actingAgentId,
          });

          return sanitizeForJson({
            success: true,
            page: {
              publicId: page.publicId,
              id: page.id,
              version: page.version,
              url: getPageUrl(page.publicId),
            },
          });
        } catch (error) {
          if (error instanceof PageConflictError) {
            return {
              success: false,
              error: "version_conflict",
              current_version: error.currentVersion,
              current_content: htmlToMarkdown(error.currentContent.html),
            };
          }
          throw error;
        }
      }),
    }),
  };
}
