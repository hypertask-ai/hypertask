import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import { SectionCrudInputSchema } from '../../validations/project.validation';
import { columnRoleFor, type BoardColumnRole } from '@/lib/mcp/boards/columnRole';
import type {
  SectionListItem,
  ListSectionsResponse,
  CreateSectionResponse,
} from './project.service';
import type { ListTasksResponse } from './task.service';
import type { TaskListItem } from './task.service';
import { buildPaginationMetadata } from '../../utils/pagination';
import { appendListQueryParams } from '@/lib/mcp/listQuery';

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

export class SectionService {
  constructor(private readonly apiClient: IApiClient) {}

  async manageSection(params: unknown, options?: { roleEnabled?: boolean }): Promise<SectionCrudResponse> {
    const validatedInput = SectionCrudInputSchema.parse(params);
    const roleEnabled = options?.roleEnabled === true;

    switch (validatedInput.action) {
      case 'list':
        return this.listSections({ ...validatedInput, role: roleEnabled ? validatedInput.role : undefined }, roleEnabled);
      case 'get':
        return this.getSectionWithTasks({
          project_id: validatedInput.project_id!,
          section_id: validatedInput.section_id!,
          include_tasks: validatedInput.include_tasks,
          limit: validatedInput.limit,
          offset: validatedInput.offset,
          role: roleEnabled ? validatedInput.role : undefined,
          roleEnabled,
        });
      case 'create':
        return this.createSection({
          project_id: validatedInput.project_id!,
          title: validatedInput.title!,
          after_section_id: validatedInput.after_section_id,
        }, roleEnabled);
      case 'update':
        return this.updateSection({
          project_id: validatedInput.project_id!,
          section_id: validatedInput.section_id!,
          title: validatedInput.title,
          move_after_section_id: validatedInput.move_after_section_id,
          is_done: validatedInput.is_done,
          auto_assign: validatedInput.auto_assign,
        }, roleEnabled);
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
    project_id?: number;
    include_hidden?: boolean;
    query?: string;
    filter?: { section?: string; label?: string | string[]; assignee?: string | number; status?: string; updated_since?: string; has_pr?: string };
    sort?: string;
    fields?: string | string[];
    limit?: number;
    cursor?: string;
    role?: BoardColumnRole;
  }, roleEnabled = false): Promise<ListSectionsResponse> {
    const correlationId = generateCorrelationId();
    const queryParams = new URLSearchParams();
    if (params.include_hidden !== undefined) {
      queryParams.append('include_hidden', String(params.include_hidden));
    }
    appendListQueryParams(queryParams, params)
    const response = await this.apiClient.makeRequest<ListSectionsResponse>(
      `/mcp/projects/${params.project_id}/sections?${queryParams.toString()}`,
      { method: 'GET' },
      correlationId
    );

    const sections = roleEnabled ? response.sections.map(withRole) : response.sections;
    logger.info('Sections listed', { correlationId, projectId: params.project_id, role: params.role });

    if (params.role === undefined) {
      return { ...response, sections };
    }
    return { ...response, sections: sections.filter((section) => section.role === params.role) };
  }

  private async getSectionWithTasks(params: {
    project_id: number;
    section_id: number;
    include_tasks?: boolean;
    limit?: number;
    offset?: number;
    role?: BoardColumnRole;
    roleEnabled?: boolean;
  }): Promise<GetSectionResponse> {
    const correlationId = generateCorrelationId();
    const includeTasks = params.include_tasks !== false;

    const sectionsResponse = await this.apiClient.makeRequest<ListSectionsResponse>(
      `/mcp/projects/${params.project_id}/sections`,
      { method: 'GET' },
      correlationId
    );

    const section = sectionsResponse.sections.find((s) => s.id === params.section_id);
    if (!section) {
      throw new Error(`Section ${params.section_id} not found in project ${params.project_id}`);
    }

    const resolved = params.roleEnabled ? withRole(section) : section;
    if (params.role !== undefined && resolved.role !== params.role) {
      throw new Error(
        `Section ${params.section_id} has role ${resolved.role}, not ${params.role}. Roles follow the column title; use action list with role to find the column.`
      );
    }

    const result: GetSectionResponse = {
      success: true,
      section: resolved,
    };

    if (!includeTasks) {
      return result;
    }

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
  }, roleEnabled = false): Promise<CreateSectionResponse> {
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

    return { ...response, section: roleEnabled ? withRole(response.section) : response.section };
  }

  private async updateSection(params: {
    project_id: number;
    section_id: number;
    title?: string;
    move_after_section_id?: number;
    is_done?: boolean | null;
    auto_assign?: number | string | null;
  }, roleEnabled = false): Promise<UpdateSectionResponse> {
    const correlationId = generateCorrelationId();
    const body: Record<string, unknown> = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.move_after_section_id !== undefined) body.move_after_section_id = params.move_after_section_id;
    if (params.is_done !== undefined) body.is_done = params.is_done;
    if (params.auto_assign !== undefined) body.auto_assign = params.auto_assign;

    const response = await this.apiClient.makeRequest<UpdateSectionResponse>(
      `/mcp/projects/${params.project_id}/sections/${params.section_id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      correlationId
    );

    return { ...response, section: roleEnabled ? withRole(response.section) : response.section };
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

function withRole(section: SectionListItem): SectionListItem {
  return { ...section, role: columnRoleFor(section) };
}
