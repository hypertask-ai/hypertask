import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import {
  AddProjectMembersInputSchema,
  BoardConfigInputSchema,
  BoardManifestInputSchema,
  BoardPlaybookInputSchema,
  CreateLabelInputSchema,
  CreateSectionInputSchema,
  ListLabelsInputSchema,
  ListProjectMembersInputSchema,
  ListProjectsInputSchema,
  ListSectionsInputSchema,
  ProjectAdminInputSchema,
} from '../../validations/project.validation';
import { buildPaginationMetadata } from '../../utils/pagination';

export interface ProjectLabel {
  id: string;
  name: string;
  color?: string;
}

export interface ProjectListItem {
  id: number;
  title: string;
  description?: string;
  name: string;
  ownerId: number;
  owner?: {
    id: number;
    email: string;
    displayName?: string;
  };
  memberCount: number;
  taskCount: number;
  defaultSections: string[];
  labels?: ProjectLabel[];
  status: 'Normal' | 'Archive' | 'Deleted';
  createdAt: string;
}

export interface ListProjectsResponse {
  success: boolean;
  projects: ProjectListItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

export interface BoardManifestResponse {
  success: boolean;
  projectId: number;
  boardTitle: string;
  columns: Array<{
    id: number;
    title: string;
    position: string;
    role: string;
    wipLimit: null;
  }>;
  transitions: string;
}

export interface BoardPlaybook {
  definition_of_done?: string[];
  working_rules?: string;
  notes?: string;
}

export interface BoardPlaybookResponse {
  success: boolean;
  projectId: number;
  playbook: BoardPlaybook | null;
}

export interface SectionListItem {
  id: number;
  section_title: string;
  projectId: number;
  visibility: boolean;
  deleted: boolean;
  ranking: string;
  /** Tickets here are finished. null means no explicit setting: fall back to the column name. */
  isDone?: boolean | null;
  /** Numeric user ID, agent UUID, or null when no rule is set. */
  autoAssign: number | string | null;
  taskCount: number;
}

export interface ListSectionsResponse {
  success: boolean;
  sections: SectionListItem[];
  projectId: number;
}

export interface CreateSectionResponse {
  success: boolean;
  section: SectionListItem;
  message?: string;
}

export interface ProjectMember {
  id: number;
  displayName: string;
  email: string;
}

export interface ProjectAgent {
  id: string;
  displayName: string;
  owner: {
    id: number;
    displayName: string;
    email: string;
  };
}

export interface ListProjectMembersResponse {
  success: boolean;
  members: (ProjectMember|ProjectAgent)[];
  projectId: number;
}
export interface AddProjectMemberResponse {
  success: boolean;
  projectId: number;
}
export interface CreateLabelResponse {
  success: boolean;
  label: ProjectLabel;
  message?: string;
}
export interface ListLabelsResponse {
  success: boolean;
  projectId: number;
  labels: ProjectLabel[];
}

type ProjectApiResponse = Record<string, unknown>;

/**
 * Service for project operations - listing projects and sections.
 */
export class ProjectService {
  constructor(private readonly apiClient: IApiClient) {}

  async listProjects(params: unknown): Promise<ListProjectsResponse> {
    const correlationId = generateCorrelationId();

    try {
      // Validate input
      const validatedInput = ListProjectsInputSchema.parse(params);

      logger.debug('Listing projects', {
        correlationId,
        status: validatedInput.status,
        search: validatedInput.search,
        limit: validatedInput.limit,
        offset: validatedInput.offset,
      });

      // Build query parameters
      const queryParams = new URLSearchParams();

      if (validatedInput.status) {
        queryParams.append('status', validatedInput.status);
      }
      if (validatedInput.search) {
        queryParams.append('search', validatedInput.search);
      }
      if (validatedInput.limit !== undefined) {
        queryParams.append('limit', String(validatedInput.limit));
      }
      if (validatedInput.offset !== undefined) {
        queryParams.append('offset', String(validatedInput.offset));
      }
      if (validatedInput.sort_by) {
        queryParams.append('sort_by', validatedInput.sort_by);
      }
      if (validatedInput.sort_order) {
        queryParams.append('sort_order', validatedInput.sort_order);
      }

      const response = await this.apiClient.makeRequest<ListProjectsResponse>(
        `/mcp/projects?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );
      logger.debug("Creating projects response", {
        correlationId,
        response,
      });

      // Add pagination metadata following MCP best practices
      const offset = validatedInput.offset || 0;
      const limit = validatedInput.limit || response.limit || response.projects.length;
      const paginationMetadata = buildPaginationMetadata({
        offset,
        limit,
        total: response.total,
        itemsCount: response.projects.length,
      });

      // logger.info('Projects listed successfully', {
      //   correlationId,
      //   resultCount: response.projects.length,
      //   total: response.total,
      //   hasMore: paginationMetadata.has_more,
      // });

      return {
        ...response,
        ...paginationMetadata,
      };
    } catch (error) {
      logger.error('Failed to list projects', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getBoardManifest(params: unknown): Promise<BoardManifestResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = BoardManifestInputSchema.parse(params);

      const response = await this.apiClient.makeRequest<BoardManifestResponse>(
        `/mcp/projects/${validatedInput.project_id}/manifest`,
        {
          method: 'GET',
        },
        correlationId
      );

      return response;
    } catch (error) {
      logger.error('Failed to get board manifest', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getBoardPlaybook(params: unknown): Promise<BoardPlaybookResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = BoardPlaybookInputSchema.parse(params);

      const response = await this.apiClient.makeRequest<BoardPlaybookResponse>(
        `/mcp/projects/${validatedInput.project_id}/playbook`,
        {
          method: 'GET',
        },
        correlationId
      );

      return response;
    } catch (error) {
      logger.error('Failed to get board playbook', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async manageBoardConfig(params: unknown): Promise<ProjectApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = BoardConfigInputSchema.parse(params);
      const isPlaybook = validatedInput.action.endsWith('playbook');
      const endpoint = `/mcp/projects/${validatedInput.project_id}/${
        isPlaybook ? 'playbook' : 'instructions'
      }`;

      if (validatedInput.action.startsWith('get_')) {
        return await this.apiClient.makeRequest<ProjectApiResponse>(
          endpoint,
          { method: 'GET' },
          correlationId
        );
      }

      const body = isPlaybook
        ? {
            definition_of_done: validatedInput.definition_of_done,
            working_rules: validatedInput.working_rules,
            notes: validatedInput.notes,
          }
        : {
            custom_instruction: validatedInput.custom_instruction,
            model_selected: validatedInput.model_selected,
          };

      return await this.apiClient.makeRequest<ProjectApiResponse>(
        endpoint,
        { method: 'PUT', body: JSON.stringify(body) },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to manage board config', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async manageProjectAdmin(params: unknown): Promise<ProjectApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ProjectAdminInputSchema.parse(params);

      if (validatedInput.action === 'archive') {
        return await this.apiClient.makeRequest<ProjectApiResponse>(
          '/mcp/projects/archive',
          {
            method: 'POST',
            body: JSON.stringify({
              project_id: validatedInput.project_id,
              ...(validatedInput.status === undefined
                ? {}
                : { status: validatedInput.status }),
            }),
          },
          correlationId
        );
      }

      return await this.apiClient.makeRequest<ProjectApiResponse>(
        `/mcp/projects/${validatedInput.project_id}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ userToAdd: validatedInput.userToAdd }),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to manage project administration', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async listSections(params: unknown): Promise<ListSectionsResponse> {
    const correlationId = generateCorrelationId();

    try {
      // Validate input
      const validatedInput = ListSectionsInputSchema.parse(params);

      logger.debug('Listing sections', {
        correlationId,
        projectId: validatedInput.project_id,
        includeHidden: validatedInput.include_hidden,
      });

      // Determine project ID (board_id is alias for project_id)
      const projectId = validatedInput.project_id;
      if (!projectId) {
        throw new Error('Either project_id or board_id must be provided');
      }

      // Build query parameters
      const queryParams = new URLSearchParams();
      if (validatedInput.include_hidden !== undefined) {
        queryParams.append('include_hidden', String(validatedInput.include_hidden));
      }

      const response = await this.apiClient.makeRequest<ListSectionsResponse>(
        `/mcp/projects/${projectId}/sections?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      // logger.info('Sections listed successfully', {
      //   correlationId,
      //   projectId: response.projectId,
      //   sectionCount: response.sections.length,
      // });

      return response;
    } catch (error) {
      logger.error('Failed to list sections', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async createSection(params: unknown): Promise<CreateSectionResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = CreateSectionInputSchema.parse(params);

      logger.debug('Creating section', {
        correlationId,
        projectId: validatedInput.project_id,
        title: validatedInput.title,
        afterSectionId: validatedInput.after_section_id,
      });

      const body: Record<string, unknown> = {
        title: validatedInput.title,
      };
      if (validatedInput.after_section_id !== undefined) {
        body.after_section_id = validatedInput.after_section_id;
      }

      const response = await this.apiClient.makeRequest<CreateSectionResponse>(
        `/mcp/projects/${validatedInput.project_id}/sections`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        correlationId
      );

      logger.info('Section created successfully', {
        correlationId,
        projectId: validatedInput.project_id,
        sectionId: response.section.id,
        sectionTitle: response.section.section_title,
      });

      return response;
    } catch (error) {
      logger.error('Failed to create section', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async createLabel(params: unknown): Promise<CreateLabelResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = CreateLabelInputSchema.parse(params);

      logger.debug('Creating label', {
        correlationId,
        projectId: validatedInput.project_id,
        name: validatedInput.name,
      });

      const body = { name: validatedInput.name };

      const response = await this.apiClient.makeRequest<CreateLabelResponse>(
        `/mcp/projects/${validatedInput.project_id}/labels`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        correlationId
      );

      logger.info('Label created successfully', {
        correlationId,
        projectId: validatedInput.project_id,
        labelId: response.label.id,
        labelName: response.label.name,
      });

      return response;
    } catch (error) {
      logger.error('Failed to create label', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async listLabels(params: unknown): Promise<ListLabelsResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ListLabelsInputSchema.parse(params);

      const response = await this.apiClient.makeRequest<ListLabelsResponse>(
        `/mcp/projects/${validatedInput.project_id}/labels`,
        {
          method: 'GET',
        },
        correlationId
      );

      return response;
    } catch (error) {
      logger.error('Failed to list labels', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async listProjectMembers(params: unknown): Promise<ListProjectMembersResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ListProjectMembersInputSchema.parse(params);

      logger.debug('Listing project members', {
        correlationId,
        projectId: validatedInput.project_id,
      });

      const response = await this.apiClient.makeRequest<ListProjectMembersResponse>(
        `/mcp/projects/${validatedInput.project_id}/members`,
        {
          method: 'GET',
        },
        correlationId
      );

      // HTPR-3035: Security — refuse to return members if backend returned wrong project
      const responseProjectId = response?.projectId ?? (response as any)?.project_id;
      if (responseProjectId != null && Number(responseProjectId) !== validatedInput.project_id) {
        logger.error('Project members response projectId mismatch (HTPR-3035)', {
          correlationId,
          requested: validatedInput.project_id,
          returned: responseProjectId,
        });
        throw new Error(
          `Security: API returned members for project ${responseProjectId} but project ${validatedInput.project_id} was requested. ` +
            `Refusing to return data (HTPR-3035).`
        );
      }

      // logger.info('Project members listed successfully', {
      //   correlationId,
      //   projectId: response.projectId,
      //   memberCount: response.members.length,
      // });

      return response;
    } catch (error) {
      logger.error('Failed to list project members', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async addProjectMember(params: unknown): Promise<AddProjectMemberResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = AddProjectMembersInputSchema.parse(params);

      const body: Record<string, unknown> = {
        projectId: validatedInput.project_id,
        userToAdd: validatedInput.user,
      };

      logger.debug('Adding project member', {
        correlationId,
        projectId: validatedInput.project_id,
      });

      //Update this to send payload please
      const response = await this.apiClient.makeRequest<AddProjectMemberResponse>(
        `/mcp/projects/${validatedInput.project_id}/members`,
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        correlationId
      );

      // HTPR-3035: Security — refuse to return members if backend returned wrong project
      const responseProjectId = response?.projectId ?? (response as any)?.project_id;
      if (responseProjectId != null && Number(responseProjectId) !== validatedInput.project_id) {
        logger.error('Project member response projectId mismatch (HTPR-3035)', {
          correlationId,
          requested: validatedInput.project_id,
          returned: responseProjectId,
        });
        throw new Error(
          `Security: API returned member for project ${responseProjectId} but project ${validatedInput.project_id} was requested. ` +
            `Refusing to return data (HTPR-3035).`
        );
      }

      logger.info('User invited to project successfully', {
        correlationId,
        projectId: response.projectId,
      });

      return response;
    } catch (error) {
      logger.error('Failed to list project members', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
