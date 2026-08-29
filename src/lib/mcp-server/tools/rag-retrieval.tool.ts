import { TOOL_METADATA } from '../config/tool-metadata'
import { RagRetrievalService } from '../lib/services/rag-retrieval.service'
import { executeWithService } from '../utils/executeWithService'
import {
  getRagRetrievalBaseSchema,
  RagRetrievalInputSchema,
} from '../validations/rag-retrieval.validation'

/**
 * Tool: rag_retrieval
 * Semantically searches tasks and comments on boards the caller can access.
 */
export const ragRetrievalTool = {
  name: TOOL_METADATA.RAG_RETRIEVAL.name,
  description: TOOL_METADATA.RAG_RETRIEVAL.description,
  parameters: getRagRetrievalBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = RagRetrievalInputSchema.parse(args)
    return executeWithService(
      context,
      RagRetrievalService,
      (service, input) => service.ragRetrieval(input, context),
      validatedInput
    )
  },
}
