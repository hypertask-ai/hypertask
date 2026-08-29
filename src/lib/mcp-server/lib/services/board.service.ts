import type { IApiClient } from '../../types/index';
import { getConfig } from '../../config/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import { CreateBoardInputSchema, type CreateBoardInput } from '../../validations/project.validation';
import { buildTaskLink, getTaskLinkInfo } from '../../utils/task-link';

export interface CreateBoardSectionResult {
  id: number;
  section_title: string;
  ranking?: string;
  taskCount?: number;
}

export interface CreateBoardLabelResult {
  id: string | number;
  name: string;
  color?: string;
}

export interface CreateBoardTaskResult {
  id: number;
  ticketNumber?: string;
  uniqueIndex?: number;
  projectId: number;
  title: string;
  sectionId: number;
  link?: { url: string; format: string; example: string };
}

export interface CreateBoardResponse {
  success: boolean;
  team_id: string | number;
  board: {
    id: number;
    title: string;
    name: string;
    status: 'Normal' | 'Archive' | 'Deleted';
    team_id?: string | number;
    link?: { url: string; format?: string };
  };
  sections: CreateBoardSectionResult[];
  labels: CreateBoardLabelResult[];
  tasks: CreateBoardTaskResult[];
  message?: string;
}

/**
 * Batch board creation from an agent-built manifest (HTPR-3142).
 */
export class BoardService {
  constructor(private readonly apiClient: IApiClient) {}

  async createBoard(params: unknown): Promise<CreateBoardResponse> {
    const correlationId = generateCorrelationId();
    const validatedInput = CreateBoardInputSchema.parse(params) as CreateBoardInput;
    const teamSegment = encodeURIComponent(String(validatedInput.team_id));

    const body: Record<string, unknown> = {
      title: validatedInput.title,
      sections: validatedInput.sections,
    };
    if (validatedInput.description !== undefined) body.description = validatedInput.description;
    if (validatedInput.labels !== undefined) body.labels = validatedInput.labels;
    if (validatedInput.tasks !== undefined) body.tasks = validatedInput.tasks;
    if (validatedInput.source_summary !== undefined) body.source_summary = validatedInput.source_summary;

    logger.debug('Creating board from manifest', {
      correlationId,
      teamId: validatedInput.team_id,
      sectionCount: validatedInput.sections.length,
      labelCount: validatedInput.labels?.length ?? 0,
      taskCount: validatedInput.tasks?.length ?? 0,
    });

    const response = await this.apiClient.makeRequest<CreateBoardResponse>(
      `/mcp/teams/${teamSegment}/boards`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      correlationId,
      { timeoutMs: getConfig().createBoardRequestTimeoutMs }
    );

    const tasksWithLinks = (response.tasks ?? []).map((task) => {
      const fromTicket = getTaskLinkInfo({
        ticketNumber: task.ticketNumber,
        projectId: task.projectId,
      });
      if (fromTicket) {
        return { ...task, link: fromTicket };
      }
      if (task.uniqueIndex != null && task.projectId) {
        const url = buildTaskLink(task.projectId, task.uniqueIndex);
        return {
          ...task,
          link: {
            url,
            format: 'https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex}',
            example: url,
          },
        };
      }
      return task;
    });

    logger.info('Board created from manifest', {
      correlationId,
      boardId: response.board?.id,
      sectionCount: response.sections?.length,
      taskCount: tasksWithLinks.length,
    });

    return {
      ...response,
      tasks: tasksWithLinks,
    };
  }
}
