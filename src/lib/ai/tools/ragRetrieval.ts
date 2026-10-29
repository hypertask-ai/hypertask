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
        // A Zod record() schema turns into a JSON Schema propertyNames keyword,
        // which the OpenAI provider strips before every request and logs as a
        // warning (HTPR-7778). The catchall object sends a schema OpenAI keeps.
        metadata_filters: z.object({}).catchall(z.unknown()).optional(),
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
