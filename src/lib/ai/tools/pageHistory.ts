import { tool } from "ai";
import { z } from "zod";
import { parsePageIdentifier } from "@/app/api/mcp/pages/_lib/routeUtils";
import { getPage, listPageVersions, restorePageVersion, archivePage } from "@/utils/controllers/pages/pageService";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createPageHistoryTool(context: ToolContext) {
  const { sendStatus, user, actingAgentId } = context;
  return {
    hypertask_page_history: tool({
      description:
        "List a page's saved versions, restore one, or archive the page. Restore REPLACES the current page content with the selected saved version. Archive hides the page. Always list versions first to get the required version_id.",
      inputSchema: z
        .object({
          action: z.enum(["versions", "restore", "archive"]),
          id: z.union([
            z.coerce.number().int().positive(),
            z.string().trim().min(1).max(100),
          ]),
          version_id: z.coerce
            .number()
            .int()
            .positive()
            .optional()
            .describe("Required when action is restore."),
        })
        .strict(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_page_history");
        const identifier = parsePageIdentifier(input.id);
        if (!identifier) {
          return { success: false, error: "Invalid page identifier" };
        }

        const existingPage = await getPage(identifier);
        if (!existingPage) {
          return { success: false, error: "Page not found" };
        }

        const access = await validateProjectAccess(
          existingPage.projectId,
          user.id
        );
        if (access.error) {
          return { success: false, error: "Page not found" };
        }

        if (input.action === "versions") {
          const versions = await listPageVersions({ pageId: existingPage.id });
          return sanitizeForJson({
            success: true,
            versions: versions.map((version) => ({
              id: version.id,
              version: version.version,
              title: version.title,
              note: version.note,
              authorId: version.authorId,
              agentId: version.agentId,
              createdAt: version.createdAt,
            })),
          });
        }

        if (input.action === "restore") {
          if (input.version_id === undefined) {
            return {
              success: false,
              error: "version_id is required for restore",
            };
          }

          const page = await restorePageVersion({
            pageId: existingPage.id,
            versionId: input.version_id,
            userId: user.id,
            agentId: actingAgentId,
          });
          return sanitizeForJson({
            success: true,
            page: {
              publicId: page.publicId,
              id: page.id,
              version: page.version,
            },
          });
        }

        await archivePage({
          id: existingPage.id,
          userId: user.id,
          agentId: actingAgentId,
        });
        return { success: true, ok: true };
      }),
    }),
  };
}
