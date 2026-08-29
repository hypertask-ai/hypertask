import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import type { ProjectListItem } from './project.service';
import { ProjectService } from './project.service';

export interface UserContextResponse {
  success: boolean;
  user: {
    id: number;
    email: string;
    displayName?: string;
  };
  boards: Array<{
    id: number;
    title: string;
    projectId?: number;
  }>;
  projects: ProjectListItem[]; // Full project details - combines with list_projects
  permissions: {
    canWriteComments: boolean;
    canReadTasks: boolean;
  };
  connected_agent: {
    id: string;
    displayName: string;
  } | null;
  all_agents: {
    id: string;
    displayName: string;
  }[];
}

/**
 * Service for fetching user context including accessible boards and permissions.
 * Following MCP best practice: Outcomes, Not Operations
 * Combines user context with full project list in a single call.
 */
export class ContextService {
  constructor(private readonly apiClient: IApiClient) {}

  async getUserContext(): Promise<UserContextResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Fetching user context', { correlationId });

      // Fetch user context from API
      const contextResponse = await this.apiClient.makeRequest<Omit<UserContextResponse, 'projects'>>(
        '/mcp/user/context',
        {
          method: 'GET',
        },
        correlationId
      );

      // Also fetch full project list - combines with list_projects functionality
      const projectService = new ProjectService(this.apiClient);
      const projectsResponse = await projectService.listProjects({
        status: 'Normal', // Only active projects in context
        limit: 100, // Get all projects (reasonable limit)
      });

      // Log the actual response for debugging
      logger.debug('User context API response', {
        correlationId,
        response: JSON.stringify(contextResponse),
        hasUser: !!contextResponse?.user,
        hasBoards: !!contextResponse?.boards,
        projectCount: projectsResponse.projects.length,
      });

      // Validate response structure
      if (!contextResponse || !contextResponse.user) {
        logger.error('Invalid user context response', {
          correlationId,
          response: JSON.stringify(contextResponse),
          responseType: typeof contextResponse,
        });
        throw new Error(`Invalid user context response: missing user data. Response: ${JSON.stringify(contextResponse)}`);
      }

      // logger.info('User context fetched successfully', {
      //   correlationId,
      //   userId: contextResponse.user.id,
      //   boardCount: contextResponse.boards?.length || 0,
      //   projectCount: projectsResponse.projects.length,
      // });

      // Combine user context with full project details
      return {
        ...contextResponse,
        projects: projectsResponse.projects,
      };
    } catch (error) {
      logger.error('Failed to fetch user context', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
