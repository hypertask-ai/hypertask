import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createRagRetrievalTool(context: ChatToolContext) {
  const { body, isLiveTaskListRequest, retrieveBoardKnowledge, sanitizeForJson, sendStatus, tool, user, z } = context;
  return tool({
      description:
        "Retrieve semantically relevant Hypertask task/comment context from Turbopuffer hybrid search. Use for conversational, ambiguous, or semantic task/comment questions. Never use it to list, count, or check whether tasks exist because the search index is not live.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        metadata_filters: z.record(z.string(), z.unknown()).optional(),
        limit: z.coerce.number().int().min(1).max(25).default(10),
      }),
      execute: async (input) => {
        sendStatus("rag_retrieval");
        if (isLiveTaskListRequest(body.message)) {
          return {
            success: false,
            error:
              "This question requires live task state. Call hypertask_list_tasks with the scope the user requested; semantic search cannot prove that a board is empty.",
          };
        }
        return sanitizeForJson(
          await retrieveBoardKnowledge(
            {
              query: input.query,
              metadataFilters: input.metadata_filters,
              limit: input.limit,
              defaultProjectId: body.default_context?.project_id,
            },
            { userId: user.id }
          )
        );
      },
    });
}
