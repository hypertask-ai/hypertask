import type { IApiClient } from '../../types/index'
import { logger } from '../../utils/logger'
import { generateCorrelationId } from '../../utils/correlation'
import { FindRelatedTasksInputSchema } from '../../validations/task.validation'

export interface RelatedTaskResult {
  ticketNumber: string
  title: string
  projectId: number
  url: string
  score?: number
}

export interface FindRelatedTasksResponse {
  success: boolean
  related: RelatedTaskResult[]
}

export class RelatedTasksService {
  constructor(private readonly apiClient: IApiClient) {}

  async findRelatedTasks(
    params: unknown
  ): Promise<FindRelatedTasksResponse> {
    const correlationId = generateCorrelationId()

    try {
      const validatedInput = FindRelatedTasksInputSchema.parse(params)

      if (validatedInput.text === undefined) {
        const queryParams = new URLSearchParams()
        if (validatedInput.task_id !== undefined) {
          queryParams.set('task_id', String(validatedInput.task_id))
        }
        if (validatedInput.ticket_number !== undefined) {
          queryParams.set('ticket_number', validatedInput.ticket_number)
        }
        if (validatedInput.unique_index !== undefined) {
          queryParams.set('unique_index', String(validatedInput.unique_index))
        }
        if (validatedInput.project_id !== undefined) {
          queryParams.set('project_id', String(validatedInput.project_id))
        }
        if (validatedInput.limit !== undefined) {
          queryParams.set('limit', String(validatedInput.limit))
        }

        return await this.apiClient.makeRequest<FindRelatedTasksResponse>(
          `/mcp/tasks/related?${queryParams.toString()}`,
          { method: 'GET' },
          correlationId
        )
      }

      return await this.apiClient.makeRequest<FindRelatedTasksResponse>(
        '/mcp/tasks/related',
        {
          method: 'POST',
          body: JSON.stringify({
            text: validatedInput.text,
            ...(validatedInput.limit === undefined
              ? {}
              : { limit: validatedInput.limit }),
          }),
        },
        correlationId
      )
    } catch (error) {
      logger.error('Failed to find related tasks', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}
