import type { IApiClient } from '../../types/index'
import { ListAgentsInputSchema } from '../../validations/agent.validation'
import { generateCorrelationId } from '../../utils/correlation'

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
    ListAgentsInputSchema.parse(params)

    return this.apiClient.makeRequest<ListAgentsResponse>(
      '/mcp/agents',
      { method: 'GET' },
      generateCorrelationId()
    )
  }
}
