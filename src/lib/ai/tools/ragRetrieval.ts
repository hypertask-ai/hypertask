import { tool } from "ai";
import { z } from "zod";
import { retrieveBoardKnowledge } from "@/lib/rag/retrieveBoardKnowledge";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createRagRetrievalTool(context: ToolContext) {
  const { sendStatus, body, user } = context;
  return {
    rag_retrieval: tool({
      description:
        "Retrieve semantically relevant Hypertask task/comment context from Turbopuffer hybrid search. Use for conversational, ambiguous, or semantic task/comment questions.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        metadata_filters: z.record(z.string(), z.unknown()).optional(),
        limit: z.coerce.number().int().min(1).max(25).default(10),
      }),
      execute: async (input) => {
        sendStatus("rag_retrieval");
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
    }),
  };
}
