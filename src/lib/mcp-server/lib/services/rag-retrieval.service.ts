import { NextRequest } from 'next/server'

import { validateMcpAuth } from '@/lib/mcp/auth'
import {
  retrieveBoardKnowledge,
  type BoardKnowledgeSearchResponse,
} from '@/lib/rag/retrieveBoardKnowledge'
import type { IApiClient } from '../../types/index'
import { RagRetrievalInputSchema } from '../../validations/rag-retrieval.validation'

export class RagRetrievalService {
  constructor(_apiClient: IApiClient) {}

  async ragRetrieval(
    params: unknown,
    bearerToken: unknown
  ): Promise<BoardKnowledgeSearchResponse> {
    const input = RagRetrievalInputSchema.parse(params)
    if (typeof bearerToken !== 'string' || !bearerToken) {
      throw new Error('Missing MCP bearer token')
    }

    const request = new NextRequest('http://localhost/api/mcp/rag-retrieval', {
      headers: { Authorization: `Bearer ${bearerToken}` },
    })
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      throw new Error('Unauthorized. Invalid or missing authentication token.')
    }

    return retrieveBoardKnowledge(
      {
        query: input.query,
        projectId: input.project_id,
        metadataFilters: input.metadata_filters,
        limit: input.limit,
      },
      {
        userId: ctx.user.id,
        agentId: ctx.agentId,
      }
    )
  }
}
