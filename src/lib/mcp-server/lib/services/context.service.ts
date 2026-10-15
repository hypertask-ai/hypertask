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
  projects: ProjectListItem[];
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

export class ContextService {
  constructor(private readonly apiClient: IApiClient) {}

  async getUserContext(): Promise<UserContextResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Fetching user context', { correlationId });

      const contextResponse = await this.apiClient.makeRequest<Omit<UserContextResponse, 'projects'>>(
        '/mcp/user/context',
        {
          method: 'GET',
        },
        correlationId
      );

      const projectService = new ProjectService(this.apiClient);
      const projectsResponse = await projectService.listProjects({
        status: 'Normal',
        limit: 100,
      });

      logger.debug('User context API response', {
        correlationId,
        response: JSON.stringify(contextResponse),
        hasUser: !!contextResponse?.user,
        hasBoards: !!contextResponse?.boards,
        projectCount: projectsResponse.projects.length,
      });

      if (!contextResponse || !contextResponse.user) {
        logger.error('Invalid user context response', {
          correlationId,
          response: JSON.stringify(contextResponse),
          responseType: typeof contextResponse,
        });
        throw new Error(`Invalid user context response: missing user data. Response: ${JSON.stringify(contextResponse)}`);
      }


      return {
        ...contextResponse,
        projects: projectsResponse.projects,
      };
    } catch (error) {
      logger.failure('Failed to fetch user context', error, {
        correlationId,
      });
      throw error;
    }
  }
}
