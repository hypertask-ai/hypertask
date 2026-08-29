import type { IApiClient } from '../../types/index';
import {
  CreatePageInputSchema,
  GetPageInputSchema,
  ListPagesInputSchema,
  PageHistoryInputSchema,
  SearchPagesInputSchema,
  UpdatePageInputSchema,
} from '../../validations/page.validation';
import { generateCorrelationId } from '../../utils/correlation';
import { logger } from '../../utils/logger';

type PageApiResponse = Record<string, unknown>;

/**
 * Service for creating, reading, updating, listing, and searching pages.
 * Validates input and makes API requests.
 */
export class PageService {
  constructor(private readonly apiClient: IApiClient) {}

  async createPage(params: unknown): Promise<PageApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = CreatePageInputSchema.parse(params);

      logger.debug('Creating page', {
        correlationId,
        taskId: validatedInput.task_id,
        ticketNumber: validatedInput.ticket_number,
        uniqueIndex: validatedInput.unique_index,
        projectId: validatedInput.project_id,
        contentType: validatedInput.content_type,
        contentLength: validatedInput.content.length,
        parentPageId: validatedInput.parent_page_id,
      });

      return await this.apiClient.makeRequest<PageApiResponse>(
        '/mcp/pages/create',
        {
          method: 'POST',
          body: JSON.stringify(validatedInput),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to create page', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getPage(params: unknown): Promise<PageApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = GetPageInputSchema.parse(params);
      const queryParams = new URLSearchParams({
        id: String(validatedInput.id),
        format: validatedInput.format,
      });

      logger.debug('Getting page', {
        correlationId,
        pageId: validatedInput.id,
        format: validatedInput.format,
      });

      return await this.apiClient.makeRequest<PageApiResponse>(
        `/mcp/pages/get?${queryParams.toString()}`,
        { method: 'GET' },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to get page', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async updatePage(params: unknown): Promise<PageApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = UpdatePageInputSchema.parse(params);

      logger.debug('Updating page', {
        correlationId,
        pageId: validatedInput.id,
        contentType: validatedInput.content_type,
        mode: validatedInput.mode,
        ifVersion: validatedInput.if_version,
        hasTitle: validatedInput.title !== undefined,
        contentLength: validatedInput.content?.length,
      });

      return await this.apiClient.makeRequest<PageApiResponse>(
        '/mcp/pages/update',
        {
          method: 'POST',
          body: JSON.stringify(validatedInput),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to update page', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async listPages(params: unknown): Promise<PageApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ListPagesInputSchema.parse(params);
      const queryParams = new URLSearchParams();

      if (validatedInput.task_id !== undefined) {
        queryParams.set('task_id', String(validatedInput.task_id));
      }
      if (validatedInput.ticket_number !== undefined) {
        queryParams.set('ticket_number', validatedInput.ticket_number);
      }
      if (validatedInput.unique_index !== undefined) {
        queryParams.set('unique_index', String(validatedInput.unique_index));
      }
      if (validatedInput.project_id !== undefined) {
        queryParams.set('project_id', String(validatedInput.project_id));
      }

      logger.debug('Listing pages', {
        correlationId,
        taskId: validatedInput.task_id,
        ticketNumber: validatedInput.ticket_number,
        uniqueIndex: validatedInput.unique_index,
        projectId: validatedInput.project_id,
      });

      return await this.apiClient.makeRequest<PageApiResponse>(
        `/mcp/pages/list?${queryParams.toString()}`,
        { method: 'GET' },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to list pages', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async searchPages(params: unknown): Promise<PageApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = SearchPagesInputSchema.parse(params);
      const queryParams = new URLSearchParams({ q: validatedInput.query });

      logger.debug('Searching pages', {
        correlationId,
        queryLength: validatedInput.query.length,
      });

      return await this.apiClient.makeRequest<PageApiResponse>(
        `/mcp/pages/search?${queryParams.toString()}`,
        { method: 'GET' },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to search pages', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async managePageHistory(params: unknown): Promise<PageApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = PageHistoryInputSchema.parse(params);

      if (validatedInput.action === 'versions') {
        const queryParams = new URLSearchParams({
          id: String(validatedInput.id),
        });
        return await this.apiClient.makeRequest<PageApiResponse>(
          `/mcp/pages/versions?${queryParams.toString()}`,
          { method: 'GET' },
          correlationId
        );
      }

      const endpoint =
        validatedInput.action === 'restore'
          ? '/mcp/pages/restore'
          : '/mcp/pages/archive';
      const body = {
        id: validatedInput.id,
        ...(validatedInput.action === 'restore'
          ? { version_id: validatedInput.version_id }
          : {}),
      };

      return await this.apiClient.makeRequest<PageApiResponse>(
        endpoint,
        { method: 'POST', body: JSON.stringify(body) },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to manage page history', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
