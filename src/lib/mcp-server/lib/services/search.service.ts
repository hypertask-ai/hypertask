import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import { EnhancedSearchTasksInputSchema } from '../../validations/task.validation';
import { getConfig } from '../../config/index';
import { buildPaginationMetadata } from '../../utils/pagination';
import { getTaskLinkInfo } from '../../utils/task-link';

export interface TaskSearchResult {
  id: number;
  ticketNumber?: string;
  title: string;
  description: string;
  boardId: number;
  boardTitle: string;
  projectId: number;
  section: string;
  createdAt: string;
  link?: {
    url: string;
    format: string;
    example: string;
  };
}

export interface SearchTasksResponse {
  success: boolean;
  tasks: TaskSearchResult[];
  total: number;
  boardId?: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

/**
 * Service for searching tasks within user's accessible boards.
 * Validates search parameters and queries the API.
 */
export class SearchService {
  constructor(private readonly apiClient: IApiClient) {}

  async searchTasks(params: unknown): Promise<SearchTasksResponse> {
    const correlationId = generateCorrelationId();

    try {
      // Validate input
      const validatedInput = EnhancedSearchTasksInputSchema.parse(params);

      logger.debug('Searching tasks', {
        correlationId,
        query: validatedInput.query,
        boardId: validatedInput.board_id,
        projectId: validatedInput.project_id,
        assignedTo: validatedInput.assigned_to,
        priority: validatedInput.priority,
        section: validatedInput.section,
        limit: validatedInput.limit,
      });

      // Build query string
      const config = getConfig();
      const queryParams = new URLSearchParams({
        q: validatedInput.query,
        limit: String(validatedInput.limit ?? config.limits.searchLimitDefault),
      });

      if (validatedInput.board_id) {
        queryParams.append('board_id', String(validatedInput.board_id));
      }

      if (validatedInput.project_id) {
        queryParams.append('project_id', String(validatedInput.project_id));
      }

      if (validatedInput.assigned_to !== undefined) {
        if (validatedInput.assigned_to === 'me') {
          queryParams.append('assigned_to', 'me');
        } else if (validatedInput.assigned_to === 'unassigned') {
          queryParams.append('assigned_to', 'unassigned');
        } else if (typeof validatedInput.assigned_to === 'number') {
          queryParams.append('assigned_to', String(validatedInput.assigned_to));
        }
      }

      if (validatedInput.priority !== undefined) {
        if (typeof validatedInput.priority === 'string') {
          queryParams.append('priority', validatedInput.priority);
        } else if (Array.isArray(validatedInput.priority)) {
          validatedInput.priority.forEach((p) => {
            queryParams.append('priority', p);
          });
        }
      }

      if (validatedInput.section) {
        queryParams.append('section', validatedInput.section);
      }

      if (validatedInput.has_due_date !== undefined) {
        queryParams.append('has_due_date', String(validatedInput.has_due_date));
      }

      if (validatedInput.status) {
        queryParams.append('status', validatedInput.status);
      }

      const response = await this.apiClient.makeRequest<SearchTasksResponse>(
        `/mcp/tasks/search?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      // Add task link information for MCP clients
      const normalizedTasks = response.tasks.map((task) => {
        const linkInfo = getTaskLinkInfo({
          ticketNumber: task.ticketNumber,
          projectId: task.projectId,
        });
        if (linkInfo) {
          return { ...task, link: linkInfo };
        }
        return task;
      });

      // Add pagination metadata following MCP best practices
      const limit = validatedInput.limit ?? config.limits.searchLimitDefault;
      const offset = 0; // Search doesn't support offset yet, but we include it for consistency
      const paginationMetadata = buildPaginationMetadata({
        offset,
        limit,
        total: response.total,
        itemsCount: normalizedTasks.length,
      });

      // logger.info('Tasks search completed', {
      //   correlationId,
      //   resultCount: normalizedTasks.length,
      //   total: response.total,
      //   hasMore: paginationMetadata.has_more,
      // });

      return {
        ...response,
        tasks: normalizedTasks,
        limit,
        offset,
        ...paginationMetadata,
      };
    } catch (error) {
      logger.error('Failed to search tasks', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
