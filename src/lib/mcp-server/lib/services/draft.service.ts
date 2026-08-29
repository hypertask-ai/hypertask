import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import {
  CreateDraftInputSchema,
  ListDraftsInputSchema,
  validateAndSanitizeDraftCrudInput,
} from '../../validations/draft.validation';

export interface DraftDetail {
  id: number;
  taskId: number;
  ticketNumber?: string;
  draftType: 'comment' | 'description';
  text: string;
  status: 'Draft' | 'Published';
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: number;
    email: string;
    displayName?: string;
  };
}

export interface CreateDraftResponse {
  success: boolean;
  draft: DraftDetail;
  message?: string;
}

export interface ListDraftsResponse {
  success: boolean;
  drafts: DraftDetail[];
}

export interface UpdateDraftResponse {
  success: boolean;
  draft: DraftDetail;
  message?: string;
}

export interface PublishDraftResponse {
  success: boolean;
  draft: DraftDetail;
  message?: string;
}

export interface DeleteDraftResponse {
  success: boolean;
  message?: string;
}

export class DraftService {
  constructor(private readonly apiClient: IApiClient) {}

  async createDraft(params: unknown): Promise<CreateDraftResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = CreateDraftInputSchema.parse(params);

      logger.debug('Creating draft', {
        correlationId,
        taskId: validatedInput.task_id,
        ticketNumber: validatedInput.ticket_number,
        draftType: validatedInput.draft_type,
        textLength: validatedInput.text.length,
      });

      const response = await this.apiClient.makeRequest<CreateDraftResponse>(
        '/mcp/drafts',
        {
          method: 'POST',
          body: JSON.stringify(validatedInput),
        },
        correlationId
      );

      logger.info('Draft created successfully', {
        correlationId,
        draftId: response.draft.id,
        taskId: response.draft.taskId,
        draftType: response.draft.draftType,
      });

      return response;
    } catch (error) {
      logger.error('Failed to create draft', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async listDrafts(params: unknown): Promise<ListDraftsResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ListDraftsInputSchema.parse(params);

      logger.debug('Listing drafts', {
        correlationId,
        taskId: validatedInput.task_id,
        ticketNumber: validatedInput.ticket_number,
      });

      const queryParams = new URLSearchParams();

      if (validatedInput.task_id) {
        queryParams.append('task_id', String(validatedInput.task_id));
      } else if (validatedInput.ticket_number) {
        queryParams.append('ticket_number', validatedInput.ticket_number);
      } else if (validatedInput.unique_index !== undefined && validatedInput.project_id !== undefined) {
        queryParams.append('project_id', String(validatedInput.project_id));
        queryParams.append('unique_index', String(validatedInput.unique_index));
      } else {
        throw new Error('Either task_id, ticket_number, or (project_id + unique_index) must be provided');
      }

      if (validatedInput.project_id && validatedInput.unique_index === undefined) {
        queryParams.append('project_id', String(validatedInput.project_id));
      }

      const response = await this.apiClient.makeRequest<ListDraftsResponse>(
        `/mcp/drafts?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      logger.info('Drafts listed successfully', {
        correlationId,
        draftCount: response.drafts?.length ?? 0,
      });

      return response;
    } catch (error) {
      logger.error('Failed to list drafts', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async updateDraft(params: { draft_id: number; text: string }): Promise<UpdateDraftResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Updating draft', {
        correlationId,
        draftId: params.draft_id,
        textLength: params.text.length,
      });

      const response = await this.apiClient.makeRequest<UpdateDraftResponse>(
        `/mcp/drafts/${params.draft_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ text: params.text }),
        },
        correlationId
      );

      logger.info('Draft updated successfully', {
        correlationId,
        draftId: params.draft_id,
      });

      return response;
    } catch (error) {
      logger.error('Failed to update draft', {
        correlationId,
        draftId: params.draft_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async publishDraft(params: { draft_id: number }): Promise<PublishDraftResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Publishing draft', {
        correlationId,
        draftId: params.draft_id,
      });

      const response = await this.apiClient.makeRequest<PublishDraftResponse>(
        `/mcp/drafts/${params.draft_id}/publish`,
        {
          method: 'POST',
        },
        correlationId
      );

      logger.info('Draft published successfully', {
        correlationId,
        draftId: params.draft_id,
      });

      return response;
    } catch (error) {
      logger.error('Failed to publish draft', {
        correlationId,
        draftId: params.draft_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async deleteDraft(params: { draft_id: number }): Promise<DeleteDraftResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Deleting draft', {
        correlationId,
        draftId: params.draft_id,
      });

      const response = await this.apiClient.makeRequest<DeleteDraftResponse>(
        `/mcp/drafts/${params.draft_id}`,
        {
          method: 'DELETE',
        },
        correlationId
      );

      logger.info('Draft deleted successfully', {
        correlationId,
        draftId: params.draft_id,
      });

      return response;
    } catch (error) {
      logger.error('Failed to delete draft', {
        correlationId,
        draftId: params.draft_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
