import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import { SectionCrudInputSchema } from '../../validations/project.validation';
import type {
  SectionListItem,
  ListSectionsResponse,
  CreateSectionResponse,
} from './project.service';
import type { ListTasksResponse } from './task.service';
import type { TaskListItem } from './task.service';
import { buildPaginationMetadata } from '../../utils/pagination';

export interface GetSectionResponse {
  success: boolean;
  section: SectionListItem;
  tasks?: TaskListItem[];
  total?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number;
}

export interface UpdateSectionResponse {
  success: boolean;
  section: SectionListItem;
  message?: string;
}

export interface DeleteSectionResponse {
  success: boolean;
  message?: string;
}

export type SectionCrudResponse =
  | ListSectionsResponse
  | GetSectionResponse
  | CreateSectionResponse
  | UpdateSectionResponse
  | DeleteSectionResponse;

/**
 * Service for section/column CRUD operations.
 * Single service handling list, get (with tasks), create, update, delete.
 */
export class SectionService {
  constructor(private readonly apiClient: IApiClient) {}

  async manageSection(params: unknown): Promise<SectionCrudResponse> {
    const validatedInput = SectionCrudInputSchema.parse(params);

    switch (validatedInput.action) {
      case 'list':
        return this.listSections({ project_id: validatedInput.project_id!, include_hidden: validatedInput.include_hidden });
      case 'get':
        return this.getSectionWithTasks({
          project_id: validatedInput.project_id!,
          section_id: validatedInput.section_id!,
          include_tasks: validatedInput.include_tasks,
          limit: validatedInput.limit,
          offset: validatedInput.offset,
        });
      case 'create':
        return this.createSection({
          project_id: validatedInput.project_id!,
          title: validatedInput.title!,
          after_section_id: validatedInput.after_section_id,
        });
      case 'update':
        return this.updateSection({
          project_id: validatedInput.project_id!,
          section_id: validatedInput.section_id!,
          title: validatedInput.title,
          move_after_section_id: validatedInput.move_after_section_id,
          is_done: validatedInput.is_done,
          auto_assign: validatedInput.auto_assign,
        });
      case 'delete':
        return this.deleteSection({
          project_id: validatedInput.project_id!,
          section_id: validatedInput.section_id!,
        });
      default: {
        const _exhaustive: never = validatedInput.action;
        throw new Error(`Unknown action: ${_exhaustive}`);
      }
    }
  }

  private async listSections(params: {
    project_id: number;
    include_hidden?: boolean;
  }): Promise<ListSectionsResponse> {
    const correlationId = generateCorrelationId();
    const queryParams = new URLSearchParams();
    if (params.include_hidden !== undefined) {
      queryParams.append('include_hidden', String(params.include_hidden));
    }

    const response = await this.apiClient.makeRequest<ListSectionsResponse>(
      `/mcp/projects/${params.project_id}/sections?${queryParams.toString()}`,
      { method: 'GET' },
      correlationId
    );

    logger.info('Sections listed', { correlationId, projectId: params.project_id });
    return response;
  }

  private async getSectionWithTasks(params: {
    project_id: number;
    section_id: number;
    include_tasks?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<GetSectionResponse> {
    const correlationId = generateCorrelationId();
    const includeTasks = params.include_tasks !== false;

    // 1. Get sections to find the section and its title
    const sectionsResponse = await this.apiClient.makeRequest<ListSectionsResponse>(
      `/mcp/projects/${params.project_id}/sections`,
      { method: 'GET' },
      correlationId
    );

    const section = sectionsResponse.sections.find((s) => s.id === params.section_id);
    if (!section) {
      throw new Error(`Section ${params.section_id} not found in project ${params.project_id}`);
    }

    const result: GetSectionResponse = {
      success: true,
      section,
    };

    if (!includeTasks) {
      return result;
    }

    // 2. Get tasks in this section (same filter as list_tasks / CLI --section id)
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const tasksQuery = new URLSearchParams({
      project_id: String(params.project_id),
      section_id: String(params.section_id),
      limit: String(limit),
      offset: String(offset),
    });

    const tasksResponse = await this.apiClient.makeRequest<ListTasksResponse>(
      `/mcp/tasks?${tasksQuery.toString()}`,
      { method: 'GET' },
      correlationId
    );

    const paginationMetadata = buildPaginationMetadata({
      offset,
      limit,
      total: tasksResponse.total,
      itemsCount: tasksResponse.tasks.length,
    });

    result.tasks = tasksResponse.tasks;
    result.total = tasksResponse.total;
    result.limit = limit;
    result.offset = offset;
    result.has_more = paginationMetadata.has_more;
    result.next_offset = paginationMetadata.next_offset;

    logger.info('Section retrieved with tasks', {
      correlationId,
      sectionId: params.section_id,
      taskCount: tasksResponse.tasks.length,
    });

    return result;
  }

  private async createSection(params: {
    project_id: number;
    title: string;
    after_section_id?: number;
  }): Promise<CreateSectionResponse> {
    const correlationId = generateCorrelationId();
    const body: Record<string, unknown> = { title: params.title };
    if (params.after_section_id !== undefined) {
      body.after_section_id = params.after_section_id;
    }

    const response = await this.apiClient.makeRequest<CreateSectionResponse>(
      `/mcp/projects/${params.project_id}/sections`,
      { method: 'POST', body: JSON.stringify(body) },
      correlationId
    );

    // logger.info('Section created', {
    //   correlationId,
    //   projectId: params.project_id,
    //   sectionId: response.section.id,
    // });

    return response;
  }

  private async updateSection(params: {
    project_id: number;
    section_id: number;
    title?: string;
    move_after_section_id?: number;
    is_done?: boolean | null;
    auto_assign?: number | string | null;
  }): Promise<UpdateSectionResponse> {
    const correlationId = generateCorrelationId();
    const body: Record<string, unknown> = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.move_after_section_id !== undefined) body.move_after_section_id = params.move_after_section_id;
    // null means "clear the flag", so only undefined is omitted.
    if (params.is_done !== undefined) body.is_done = params.is_done;
    if (params.auto_assign !== undefined) body.auto_assign = params.auto_assign;

    const response = await this.apiClient.makeRequest<UpdateSectionResponse>(
      `/mcp/projects/${params.project_id}/sections/${params.section_id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      correlationId
    );

    // logger.info('Section updated', {
    //   correlationId,
    //   sectionId: params.section_id,
    // });

    return response;
  }

  private async deleteSection(params: {
    project_id: number;
    section_id: number;
  }): Promise<DeleteSectionResponse> {
    const correlationId = generateCorrelationId();

    const response = await this.apiClient.makeRequest<DeleteSectionResponse>(
      `/mcp/projects/${params.project_id}/sections/${params.section_id}`,
      { method: 'DELETE' },
      correlationId
    );

    logger.info('Section deleted', {
      correlationId,
      sectionId: params.section_id,
    });

    return response;
  }
}
