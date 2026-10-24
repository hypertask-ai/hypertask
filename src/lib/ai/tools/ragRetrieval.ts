import { jsonSchema, tool, zodSchema } from "ai";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7778_RAG_SCHEMA_FLAG } from "@/lib/flags/definitions/htpr-7778-rag-schema";
import { z } from "zod";
import { retrieveBoardKnowledge } from "@/lib/rag/retrieveBoardKnowledge";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createRagRetrievalTool(context: ToolContext) {
  const { sendStatus, body, user } = context;
  const inputSchema = z.object({
    query: z.string().min(1).max(500),
    metadata_filters: z.record(z.string(), z.unknown()).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  });
  return {
    rag_retrieval: tool({
      description:
        "Retrieve semantically relevant Hypertask task/comment context from Turbopuffer hybrid search. Use for conversational, ambiguous, or semantic task/comment questions.",
      inputSchema: jsonSchema<z.infer<typeof inputSchema>>(
        async () => {
          const schema = await isFeatureEnabled(HTPR_7778_RAG_SCHEMA_FLAG, user.id)
            ? inputSchema.extend({
                metadata_filters: z.object({}).catchall(z.unknown()).optional(),
              })
            : inputSchema;
          return zodSchema(schema).jsonSchema;
        },
        { validate: zodSchema(inputSchema).validate }
      ),
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
