import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskSearchPagesTool(context: ChatToolContext) {
  const { getAccessibleProjectIds, sanitizeForJson, searchPages, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Search page titles and content across every Hypertask project the current user can access. Returns brief text snippets from matching long-form pages.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_search_pages");
        const projectIds = await getAccessibleProjectIds(user.id);
        const matches = await searchPages({
          query: input.query,
          projectIds,
        });

        return sanitizeForJson({
          success: true,
          pages: matches.map((page) => ({
            publicId: page.publicId,
            id: page.id,
            title: page.title,
            taskId: page.taskId,
            snippet: page.contentText.slice(0, 200),
            updatedAt: page.updatedAt,
          })),
        });
      }),
    });
}
