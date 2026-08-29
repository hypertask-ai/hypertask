import type { IApiClient } from '../../types/index'
import type { DecisionRequestCrudInput } from '../../validations/decision-request.validation'
import { generateCorrelationId } from '../../utils/correlation'
import { logger } from '../../utils/logger'

export interface DecisionRequestDetail {
  id: number
  taskId: number
  question: string
  options: string[]
  status: 'pending' | 'answered' | 'cancelled'
  answer: string | null
  answerNote: string | null
  createdAt: string
  answeredAt: string | null
  commentId: number | null
}

export interface DecisionRequestResponse {
  success: boolean
  decision_request: DecisionRequestDetail
  comment_id?: number
}

export interface ListDecisionRequestsResponse {
  success: boolean
  decision_requests: DecisionRequestDetail[]
}

type CreateParams = Pick<
  DecisionRequestCrudInput,
  'task_id' | 'ticket_number' | 'project_id' | 'unique_index' | 'question' | 'options'
>

type ListParams = Pick<
  DecisionRequestCrudInput,
  'task_id' | 'ticket_number' | 'project_id' | 'unique_index' | 'status'
>

export class DecisionRequestService {
  constructor(private readonly apiClient: IApiClient) {}

  async createDecisionRequest(params: CreateParams): Promise<DecisionRequestResponse> {
    const correlationId = generateCorrelationId()
    try {
      const response = await this.apiClient.makeRequest<DecisionRequestResponse>(
        '/mcp/decisions',
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
        correlationId
      )

      logger.info('Decision request created', {
        correlationId,
        decisionRequestId: response.decision_request.id,
        taskId: response.decision_request.taskId,
      })
      return response
    } catch (error) {
      logger.error('Failed to create decision request', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async listDecisionRequests(params: ListParams): Promise<ListDecisionRequestsResponse> {
    const correlationId = generateCorrelationId()
    try {
      const queryParams = new URLSearchParams()
      if (params.task_id !== undefined) {
        queryParams.set('task_id', String(params.task_id))
      } else if (params.ticket_number !== undefined) {
        queryParams.set('ticket_number', params.ticket_number)
        if (params.project_id !== undefined) {
          queryParams.set('project_id', String(params.project_id))
        }
      } else if (params.unique_index !== undefined && params.project_id !== undefined) {
        queryParams.set('unique_index', String(params.unique_index))
        queryParams.set('project_id', String(params.project_id))
      }
      if (params.status !== undefined) {
        queryParams.set('status', params.status)
      }

      const response = await this.apiClient.makeRequest<ListDecisionRequestsResponse>(
        `/mcp/decisions?${queryParams.toString()}`,
        { method: 'GET' },
        correlationId
      )

      logger.info('Decision requests listed', {
        correlationId,
        count: response.decision_requests.length,
      })
      return response
    } catch (error) {
      logger.error('Failed to list decision requests', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async getDecisionRequest(decisionRequestId: number): Promise<DecisionRequestResponse> {
    const correlationId = generateCorrelationId()
    try {
      return await this.apiClient.makeRequest<DecisionRequestResponse>(
        `/mcp/decisions/${decisionRequestId}`,
        { method: 'GET' },
        correlationId
      )
    } catch (error) {
      logger.error('Failed to get decision request', {
        correlationId,
        decisionRequestId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async answerDecisionRequest(
    decisionRequestId: number,
    selectedOption: string,
    note?: string
  ): Promise<DecisionRequestResponse> {
    const correlationId = generateCorrelationId()
    try {
      return await this.apiClient.makeRequest<DecisionRequestResponse>(
        `/mcp/decisions/${decisionRequestId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'answer',
            selected_option: selectedOption,
            ...(note !== undefined ? { note } : {}),
          }),
        },
        correlationId
      )
    } catch (error) {
      logger.error('Failed to answer decision request', {
        correlationId,
        decisionRequestId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async cancelDecisionRequest(decisionRequestId: number): Promise<DecisionRequestResponse> {
    const correlationId = generateCorrelationId()
    try {
      return await this.apiClient.makeRequest<DecisionRequestResponse>(
        `/mcp/decisions/${decisionRequestId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' }),
        },
        correlationId
      )
    } catch (error) {
      logger.error('Failed to cancel decision request', {
        correlationId,
        decisionRequestId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}
