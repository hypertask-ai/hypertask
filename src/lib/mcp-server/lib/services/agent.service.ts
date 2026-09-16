import type { IApiClient } from '../../types/index'
import { ListAgentsInputSchema } from '../../validations/agent.validation'
import { generateCorrelationId } from '../../utils/correlation'
import { appendListQueryParams } from '@/lib/mcp/listQuery'

export interface OwnedAgentListItem {
  id: string
  display_name: string
  revoked: boolean
  created_at: string
  boards: Array<{ id: number; name: string }>
}

export interface ListAgentsResponse {
  success: boolean
  agents: OwnedAgentListItem[]
}

export class AgentService {
  constructor(private readonly apiClient: IApiClient) {}

  async listAgents(params: unknown): Promise<ListAgentsResponse> {
    const validatedInput = ListAgentsInputSchema.parse(params)
    const queryParams = new URLSearchParams()
    appendListQueryParams(queryParams, validatedInput)
    const query = queryParams.toString()

    return this.apiClient.makeRequest<ListAgentsResponse>(
      query ? `/mcp/agents?${query}` : '/mcp/agents',
      { method: 'GET' },
      generateCorrelationId()
    )
  }
}
