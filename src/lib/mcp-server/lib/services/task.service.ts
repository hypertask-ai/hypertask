import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import {
  ListTasksInputSchema,
  GetTaskInputSchema,
  GetTaskTreeInputSchema,
  UpdateTaskInputSchema,
  CreateTaskInputSchema,
  MoveTaskBetweenBoardsInputSchema,
  AssignUserInputSchema,
  LinkTasksInputSchema,
  NextTasksInputSchema,
  TaskDescriptionHistoryInputSchema,
  TaskContextInputSchema,
} from '../../validations/task.validation';
import { getPriorityValue, getEstimateValue, getEstimateFullValue } from '../../utils/constants';
import { buildPaginationMetadata } from '../../utils/pagination';
import { getTaskLinkInfo } from '../../utils/task-link';
import {
  attachFilesAfterMutation,
  type AttachmentUploadItem,
} from './attachment.service';
import {
  idempotencyKeyForInvocation,
  type McpInvocationIdentity,
} from '../../utils/invocation-idempotency';

export interface TaskDetail {
  id: number;
  ticketNumber?: string;
  title: string;
  description: string;
  descriptionJson?: unknown;
  section: string;
  sectionId: number;
  boardId: number;
  boardTitle: string;
  parent_id?: number;
  parent_task?: {
    id: number
    ticketNumber?: string
    title: string
    uniqueIndex: number 
  },
  sub_tasks: Array<{
    id: number
    ticketNumber?: string
    title: string
    uniqueIndex: number 
  }>;
  projectId: number;
  status: 'Normal' | 'Archive' | 'Deleted';
  priority?: {
    id: string;
    priority_index: number;
    Priority_Value: 'No Priority' | 'Urgent' | 'High' | 'Medium' | 'Low';
  };
  estimate?: {
    id: string;
    estimate_index: number;
    estimate_value: string;
    estimate_full_value?: string;
  };
  dueDate?: string;
  assignees?: Array<{
    id: number;
    email: string;
    displayName?: string;
  }>;
  followers?: Array<{
    id: number;
    email: string;
    displayName?: string;
  }>;
  labels?: Array<{
    id: string | number;
    name: string;
    color?: string;
  }>;
  attachments?: Array<{
    id: number;
    fileName: string;
    fileType: string;
    fileSize: number;
  }>;
  totalComments: number;
  createdAt: string;
  updatedAt: string;
  permanentlyDeleteAt: string | null;
  createdBy?: {
    id: number;
    email: string;
    displayName?: string;
  };
  link?: {
    url: string;
    format: string;
    example: string;
  };
}

export interface TaskListItem {
  id: number;
  ticketNumber?: string;
  title: string;
  description: string;
  section: string;
  sectionId: number;
  boardId: number;
  boardTitle: string;
  parent_id?: number;
  parent_task?: {
    id: number
    ticketNumber?: string
    title: string
    uniqueIndex: number 
  },
  sub_tasks: Array<{
    id: number
    ticketNumber?: string
    title: string
    uniqueIndex: number 
  }>;
  projectId: number;
  status: 'Normal' | 'Archive' | 'Deleted';
  priority?: 'Urgent' | 'High' | 'Medium' | 'Low';
  dueDate?: string;
  assigneeCount: number;
  labels: Array<{
    id: string | number;
    name: string;
  }>;
  labelCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  permanentlyDeleteAt: string | null;
  link?: {
    url: string;
    format: string;
    example: string;
  };
}

export interface ListTasksResponse {
  success: boolean;
  tasks: TaskListItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

export interface GetTaskResponse {
  success: boolean;
  tasks: TaskDetail[];
}

export interface UpdateTaskResponse {
  success: boolean;
  task: TaskDetail; // or TaskListItem if API returns simplified version
  attachments?: AttachmentUploadItem[];
  attachment_status?: 'complete' | 'partial' | 'failed';
  failed_files?: Array<{ index: number; filename: string; error: string }>;
  attachment_error?: string;
  cleanup_confirmed?: boolean;
  retry_note?: string;
  message?: string;
}

export interface CreateTaskResponse {
  success: boolean;
  task: TaskDetail;
  attachments?: AttachmentUploadItem[];
  attachment_status?: 'complete' | 'partial' | 'failed';
  failed_files?: Array<{ index: number; filename: string; error: string }>;
  attachment_error?: string;
  cleanup_confirmed?: boolean;
  retry_note?: string;
  message?: string;
}

export interface AssignUserResponse {
  success: boolean;
  assignees: Array<{ userId: number }>;
  assignStatus: 'Assigned' | 'Unassigned' | 'Conflict';
  assignmentOutcome?: 'created' | 'already-assigned';
  task?: TaskDetail;
  message?: string;
}

export interface TaskTreeNode {
  id: number;
  ticketNumber?: string;
  title: string;
  uniqueIndex?: number;
  children?: TaskTreeNode[];
}

export interface GetTaskTreeResponse {
  success: boolean;
  tree: TaskTreeNode;
}

export interface TaskContextResponse {
  success: boolean;
  task: {
    id: number;
    ticketNumber?: string;
    title: string;
    description: string;
    section: string;
    labels: unknown[];
    assignees: unknown[];
    priority?: unknown;
    dueDate?: string;
  };
  parent: unknown | null;
  subtasks: unknown[];
  relatedTasks: Array<{
    id: number;
    ticketNumber?: string;
    title: string;
    uniqueIndex: number;
    relationType: string;
    direction: 'outgoing' | 'incoming';
  }>;
  comments: Array<{
    id: number;
    author: string;
    text: string;
    createdAt: string;
  }>;
  linkedPRs: string[];
  commentCount: number;
  truncated: boolean;
}

export interface NextTasksResponse {
  success: boolean;
  tasks: Array<{
    id: number;
    ticketNumber?: string;
    title: string;
    section: string;
    priority?: string;
    dueDate?: string;
    score: number;
    labels: Array<{
      id: string;
      name: string;
    }>;
  }>;
  total: number;
}

export interface LinkTasksResponse {
  success: boolean;
  relation?: {
    id: number;
    sourceTaskId: number;
    targetTaskId: number;
    relationType: 'RelatedTo' | 'BlockedBy' | 'BlockedTo';
  };
  relations?: Array<{
    relationType: 'RelatedTo' | 'BlockedBy' | 'BlockedTo';
    direction: 'outgoing' | 'incoming';
    otherTask: {
      id: number;
      ticketNumber: string | null;
      title: string;
      status: string;
    };
  }>;
  deleted?: number;
}

type TaskDescriptionHistoryResponse = Record<string, unknown>;

/**
 * Service for task operations - listing and retrieving tasks.
 */
export class TaskService {
  constructor(private readonly apiClient: IApiClient) { }

  async listTasks(params: unknown): Promise<ListTasksResponse> {
    const correlationId = generateCorrelationId();

    try {
      // Validate input
      const validatedInput = ListTasksInputSchema.parse(params);

      logger.debug('Listing tasks', {
        correlationId,
        projectId: validatedInput.project_id,
        sectionId: validatedInput.section_id,
        section: validatedInput.section,
        assignedTo: validatedInput.assigned_to,
        limit: validatedInput.limit,
        offset: validatedInput.offset,
      });

      // Build query parameters
      const queryParams = new URLSearchParams();

      if (validatedInput.project_id) {
        queryParams.append('project_id', String(validatedInput.project_id));
      }
      if (validatedInput.section_id !== undefined) {
        queryParams.append('section_id', String(validatedInput.section_id));
      } else if (validatedInput.section) {
        queryParams.append('section', validatedInput.section);
      }
      if (validatedInput.assigned_to !== undefined) {
        if (validatedInput.assigned_to === 'me') {
          queryParams.append('assigned_to', 'me');
        } else if (validatedInput.assigned_to === 'unassigned') {
          queryParams.append('assigned_to', 'unassigned');
        } else if (typeof validatedInput.assigned_to === 'number') {
          queryParams.append('assigned_to', String(validatedInput.assigned_to));
        } else if (Array.isArray(validatedInput.assigned_to)) {
          validatedInput.assigned_to.forEach((userId) => {
            queryParams.append('assigned_to', String(userId));
          });
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
      if (validatedInput.has_due_date !== undefined) {
        queryParams.append('has_due_date', String(validatedInput.has_due_date));
      }
      if (validatedInput.due_date_before) {
        queryParams.append('due_date_before', validatedInput.due_date_before);
      }
      if (validatedInput.due_date_after) {
        queryParams.append('due_date_after', validatedInput.due_date_after);
      }
      if (validatedInput.status) {
        queryParams.append('status', validatedInput.status);
      }
      if (validatedInput.labels) {
        const labelsArray = Array.isArray(validatedInput.labels)
          ? validatedInput.labels
          : [validatedInput.labels];
        labelsArray.forEach((label: string | number) => {
          queryParams.append('labels', String(label));
        });
      }
      if (validatedInput.created_by) {
        queryParams.append('created_by', String(validatedInput.created_by));
      }
      if (validatedInput.updated_since) {
        queryParams.append('updated_since', validatedInput.updated_since);
      }
      if (validatedInput.created_since) {
        queryParams.append('created_since', validatedInput.created_since);
      }
      if (validatedInput.has_comments !== undefined) {
        queryParams.append('has_comments', String(validatedInput.has_comments));
      }
      if (validatedInput.has_attachments !== undefined) {
        queryParams.append('has_attachments', String(validatedInput.has_attachments));
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

      const response = await this.apiClient.makeRequest<ListTasksResponse>(
        `/mcp/tasks?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      // Guard against undefined/malformed response (HTPR-3030)
      const rawTasks = response?.tasks ?? [];
      const validTasks = rawTasks.filter((t): t is TaskListItem => t != null);

      // Normalize priority values in list response
      // Note: ListTasksResponse uses simplified priority string, so we need to handle it differently
      // If the API returns priority as a string, we keep it as-is
      // If it returns priority_index, we normalize it
      const normalizedTasks = validTasks.map((task) => {
        // TaskListItem has priority as optional string, so normalization happens at API level
        // or we'd need to change the interface to include priority_index

        // Add task link information for MCP clients (guard task.projectId)
        const linkInfo =
          task.projectId != null
            ? getTaskLinkInfo({
                ticketNumber: task.ticketNumber,
                projectId: task.projectId,
              })
            : null;
        if (linkInfo) {
          return { ...task, link: linkInfo };
        }

        return task;
      });

      // Add pagination metadata following MCP best practices
      const offset = validatedInput.offset ?? 0;
      const limit = validatedInput.limit ?? response?.limit ?? normalizedTasks.length;
      const total = response?.total ?? normalizedTasks.length;
      const paginationMetadata = buildPaginationMetadata({
        offset,
        limit,
        total,
        itemsCount: normalizedTasks.length,
      });

      // logger.info('Tasks listed successfully', {
      //   correlationId,
      //   resultCount: normalizedTasks.length,
      //   total: response.total,
      //   hasMore: paginationMetadata.has_more,
      // });

      return {
        ...response,
        tasks: normalizedTasks,
        ...paginationMetadata,
      };
    } catch (error) {
      logger.error('Failed to list tasks', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getTask(params: unknown): Promise<GetTaskResponse> {
    const correlationId = generateCorrelationId();

    try {
      // Validate input
      const validatedInput = GetTaskInputSchema.parse(params);

      // logger.debug('Getting tasks', {
      //   correlationId,
      //   taskIdCount: validatedInput.task_id?.length,
      //   ticketNumberCount: validatedInput.ticket_number?.length,
      //   projectId: validatedInput.project_id,
      //   uniqueIndex: validatedInput.unique_index,
      // });

      // Build query parameters for single API call
      const queryParams = new URLSearchParams();

      if (validatedInput.task_id) {
        // Add all task IDs to query params
        validatedInput.task_id.forEach((taskId) => {
          queryParams.append('task_id', String(taskId));
        });
      } else if (validatedInput.ticket_number) {
        // Add all ticket numbers to query params
        validatedInput.ticket_number.forEach((ticketNumber) => {
          queryParams.append('ticket_number', ticketNumber);
        });
      } else if (validatedInput.unique_index !== undefined && validatedInput.project_id !== undefined) {
        // Efficient lookup by project_id + unique_index
        queryParams.append('project_id', String(validatedInput.project_id));
        queryParams.append('unique_index', String(validatedInput.unique_index));
      }

      if (validatedInput.project_id && validatedInput.unique_index === undefined) {
        // Only add project_id if not using unique_index lookup (it's already added above)
        queryParams.append('project_id', String(validatedInput.project_id));
      }

      // Make single API call with all IDs/ticket numbers
      const response = await this.apiClient.makeRequest<GetTaskResponse>(
        `/mcp/tasks?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      const tasks = response.tasks || [];

      // Normalize priority and estimate values based on indices
      const normalizedTasks = tasks.map((task) => {
        const normalizedTask = { ...task };

        // Normalize priority: use index to get correct value, ignoring API's Priority_Value
        if (normalizedTask.priority?.priority_index !== undefined) {
          normalizedTask.priority = {
            ...normalizedTask.priority,
            Priority_Value: getPriorityValue(normalizedTask.priority.priority_index),
          };
        }

        // Normalize estimate: use index to get correct value, ignoring API's estimate_value
        if (normalizedTask.estimate?.estimate_index !== undefined) {
          normalizedTask.estimate = {
            ...normalizedTask.estimate,
            estimate_value: getEstimateValue(normalizedTask.estimate.estimate_index),
            estimate_full_value: getEstimateFullValue(normalizedTask.estimate.estimate_index),
          };
        }

        // Add task link information for MCP clients
        const linkInfo = getTaskLinkInfo({
          ticketNumber: normalizedTask.ticketNumber,
          projectId: normalizedTask.projectId,
        });
        if (linkInfo) {
          normalizedTask.link = linkInfo;
        }

        return normalizedTask;
      });

      // logger.info('Tasks retrieved successfully', {
      //   correlationId,
      //   taskCount: normalizedTasks.length,
      //   lookupMethod: validatedInput.unique_index !== undefined ? 'project_id+unique_index' : validatedInput.task_id ? 'task_id' : 'ticket_number',
      // });

      return {
        success: true,
        tasks: normalizedTasks,
      };
    } catch (error) {
      logger.error('Failed to get tasks', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getTaskContext(params: unknown): Promise<TaskContextResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = TaskContextInputSchema.parse(params);
      const queryParams = new URLSearchParams();

      queryParams.append('task_id', String(validatedInput.task_id));
      queryParams.append('project_id', String(validatedInput.project_id));
      if (validatedInput.summary !== undefined) {
        queryParams.append('summary', String(validatedInput.summary));
      }

      const response = await this.apiClient.makeRequest<TaskContextResponse>(
        `/mcp/tasks/context?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      return response;
    } catch (error) {
      logger.error('Failed to get task context', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getNextTasks(params: unknown): Promise<NextTasksResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = NextTasksInputSchema.parse(params);
      const queryParams = new URLSearchParams();

      queryParams.append('project_id', String(validatedInput.project_id));
      if (validatedInput.limit !== undefined) {
        queryParams.append('limit', String(validatedInput.limit));
      }
      if (validatedInput.section !== undefined) {
        queryParams.append('section', validatedInput.section);
      }
      if (validatedInput.exclude_blocked !== undefined) {
        queryParams.append(
          'exclude_blocked',
          String(validatedInput.exclude_blocked)
        );
      }
      if (validatedInput.labels !== undefined) {
        queryParams.append('labels', validatedInput.labels);
      }
      if (validatedInput.cursor !== undefined) {
        queryParams.append('cursor', validatedInput.cursor);
      }

      const response = await this.apiClient.makeRequest<NextTasksResponse>(
        `/mcp/tasks/next?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      return response;
    } catch (error) {
      logger.error('Failed to get next tasks', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async linkTasks(params: unknown): Promise<LinkTasksResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = LinkTasksInputSchema.parse(params);

      if (validatedInput.action === 'list') {
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

        return await this.apiClient.makeRequest<LinkTasksResponse>(
          `/mcp/tasks/relations?${queryParams.toString()}`,
          { method: 'GET' },
          correlationId
        );
      }

      const body = {
        source_task_id: validatedInput.source_task_id,
        source_ticket_number: validatedInput.source_ticket_number,
        source_unique_index: validatedInput.source_unique_index,
        source_project_id: validatedInput.source_project_id,
        target_task_id: validatedInput.target_task_id,
        target_ticket_number: validatedInput.target_ticket_number,
        target_unique_index: validatedInput.target_unique_index,
        target_project_id: validatedInput.target_project_id,
        project_id: validatedInput.project_id,
        ...(validatedInput.action === 'link'
          ? { relation_type: validatedInput.relation_type }
          : {}),
      };

      const response = await this.apiClient.makeRequest<LinkTasksResponse>(
        '/mcp/tasks/relations',
        {
          method: validatedInput.action === 'link' ? 'POST' : 'DELETE',
          body: JSON.stringify(body),
        },
        correlationId
      );

      return response;
    } catch (error) {
      logger.error('Failed to link tasks', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async manageTaskDescriptionHistory(
    params: unknown
  ): Promise<TaskDescriptionHistoryResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = TaskDescriptionHistoryInputSchema.parse(params);

      if (validatedInput.action === 'versions') {
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
        return await this.apiClient.makeRequest<TaskDescriptionHistoryResponse>(
          `/mcp/tasks/description-versions?${queryParams.toString()}`,
          { method: 'GET' },
          correlationId
        );
      }

      return await this.apiClient.makeRequest<TaskDescriptionHistoryResponse>(
        '/mcp/tasks/description-restore',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(validatedInput.task_id === undefined
              ? {}
              : { task_id: validatedInput.task_id }),
            ...(validatedInput.ticket_number === undefined
              ? {}
              : { ticket_number: validatedInput.ticket_number }),
            ...(validatedInput.unique_index === undefined
              ? {}
              : { unique_index: validatedInput.unique_index }),
            ...(validatedInput.project_id === undefined
              ? {}
              : { project_id: validatedInput.project_id }),
            version_id: validatedInput.version_id,
          }),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to manage task description history', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getTaskTree(params: unknown): Promise<GetTaskTreeResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = GetTaskTreeInputSchema.parse(params);

      logger.debug('Getting task tree', {
        correlationId,
        hasTicket: validatedInput.ticket_number !== undefined,
        hasTaskId: validatedInput.task_id !== undefined,
        depth: validatedInput.depth,
      });

      const queryParams = new URLSearchParams();

      if (validatedInput.ticket_number !== undefined) {
        queryParams.append('ticket_number', validatedInput.ticket_number);
      } else if (validatedInput.task_id !== undefined) {
        queryParams.append('task_id', String(validatedInput.task_id));
      }

      if (validatedInput.depth !== undefined) {
        queryParams.append('depth', String(validatedInput.depth));
      }

      const response = await this.apiClient.makeRequest<GetTaskTreeResponse>(
        `/mcp/tasks/tree?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      // logger.info('Task tree retrieved successfully', { correlationId });

      return response;
    } catch (error) {
      logger.error('Failed to get task tree', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async updateTask(
    params: unknown,
    invocation?: McpInvocationIdentity
  ): Promise<UpdateTaskResponse> {
    const correlationId = generateCorrelationId();
    try {
      // Validate input
      const validatedInput = UpdateTaskInputSchema.parse(params);
      const { attachments, ...taskUpdate } = validatedInput;
      const hasTaskFieldUpdate =
        taskUpdate.title !== undefined ||
        taskUpdate.description !== undefined ||
        taskUpdate.priority !== undefined ||
        taskUpdate.estimate !== undefined ||
        taskUpdate.status !== undefined ||
        taskUpdate.sectionId !== undefined ||
        taskUpdate.labels !== undefined ||
        taskUpdate.due_date !== undefined ||
        taskUpdate.assignee !== undefined ||
        taskUpdate.parent_task_id !== undefined;

      let response: UpdateTaskResponse;
      if (hasTaskFieldUpdate) {
        const idempotencyKey = idempotencyKeyForInvocation(
          'update_task',
          invocation,
          validatedInput
        );
        response = await this.apiClient.makeRequest<UpdateTaskResponse>(
          "/mcp/tasks/update",
          {
            method: 'POST',
            body: JSON.stringify(taskUpdate),
            ...(idempotencyKey
              ? { headers: { 'Idempotency-Key': idempotencyKey } }
              : {}),
          },
          correlationId
        );
      } else {
        const taskLookup = await this.getTask(
          taskUpdate.task_id !== undefined
            ? { task_id: [taskUpdate.task_id] }
            : taskUpdate.ticket_number !== undefined
              ? {
                  ticket_number: [taskUpdate.ticket_number],
                  ...(taskUpdate.project_id === undefined
                    ? {}
                    : { project_id: taskUpdate.project_id }),
                }
              : {
                  project_id: taskUpdate.project_id,
                  unique_index: taskUpdate.unique_index,
                }
        );
        response = {
          success: true,
          task: taskLookup.tasks[0],
        };
      }

      // HTPR-3772: the server returns no `task` when the identifier matched nothing
      // (e.g. a bare numeric ticket like "3772" instead of "HTPR-3772"). Fail clean
      // instead of dereferencing undefined.
      if (!response.task) {
        throw new Error(response.message || 'Task not found or access denied');
      }

      // Add task link information for MCP clients
      const linkInfo = getTaskLinkInfo({
        ticketNumber: response.task.ticketNumber,
        projectId: response.task.projectId,
      });
      if (linkInfo) {
        response.task.link = linkInfo;
      }

      if (attachments !== undefined) {
        if (!hasTaskFieldUpdate) {
          const attachmentResult = await attachFilesAfterMutation(
            this.apiClient,
            { task_id: response.task.id, files: attachments },
            `Task ${response.task.ticketNumber ?? response.task.id} lookup`
          );
          return {
            ...response,
            success: attachmentResult.attachment_status === 'complete',
            attachments: attachmentResult.attachments ?? [],
            attachment_status: attachmentResult.attachment_status,
            failed_files: attachmentResult.failed_files,
            attachment_error: attachmentResult.attachment_error,
            cleanup_confirmed: attachmentResult.cleanup_confirmed,
            retry_note: attachmentResult.retry_note,
            message: attachmentResult.message,
          };
        }
        const attachmentOutcome = await attachFilesAfterMutation(
          this.apiClient,
          { task_id: response.task.id, files: attachments },
          `Task ${response.task.ticketNumber ?? response.task.id} update`
        );
        return { ...response, ...attachmentOutcome };
      }

      // logger.info('Task updated successfully', {
      //   correlationId,
      //   taskId: response.task.id,
      //   ticketNumber: response.task.ticketNumber,
      //   projectId: response.task.projectId,
      // });

      return response;
    } catch (error) {
      logger.error('Failed to update task', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async createTask(
    params: unknown,
    invocation?: McpInvocationIdentity
  ): Promise<CreateTaskResponse> {
    const correlationId = generateCorrelationId();
    try {
      // Validate input
      const validatedInput = CreateTaskInputSchema.parse(params);
      const { attachments, ...taskInput } = validatedInput;

      logger.debug('Creating task', {
        correlationId,
        projectId: validatedInput.project_id,
        title: validatedInput.title,
        sectionId: validatedInput.section_id,
      });

      // Build explicit body to ensure project_id is always sent (fixes "Project identifier is required" from backends)
      const body: Record<string, unknown> = {
        project_id: taskInput.project_id,
        title: taskInput.title,
      };
      if (taskInput.description !== undefined) body.description = taskInput.description;
      if (taskInput.content_type !== undefined) body.content_type = taskInput.content_type;
      if (taskInput.section_id !== undefined) body.section_id = taskInput.section_id;
      if (taskInput.priority !== undefined) body.priority = taskInput.priority;
      if (taskInput.estimate !== undefined) body.estimate = taskInput.estimate;
      if (taskInput.labels !== undefined) body.labels = taskInput.labels;
      if (taskInput.due_date !== undefined) body.due_date = taskInput.due_date;
      if (taskInput.parent_task_id !== undefined) body.parent_task_id = taskInput.parent_task_id;
      if (taskInput.assignee !== undefined) body.assignee = taskInput.assignee;

      const idempotencyKey = idempotencyKeyForInvocation(
        'create_task',
        invocation,
        validatedInput
      );
      const response = await this.apiClient.makeRequest<CreateTaskResponse>(
        "/mcp/tasks/create",
        {
          method: 'POST',
          body: JSON.stringify(body),
          ...(idempotencyKey
            ? { headers: { 'Idempotency-Key': idempotencyKey } }
            : {}),
        },
        correlationId
      );

      // Add task link information for MCP clients
      const linkInfo = getTaskLinkInfo({
        ticketNumber: response.task.ticketNumber,
        projectId: response.task.projectId,
      });
      if (linkInfo) {
        response.task.link = linkInfo;
      }

      if (attachments !== undefined) {
        const attachmentOutcome = await attachFilesAfterMutation(
          this.apiClient,
          { task_id: response.task.id, files: attachments },
          `Task ${response.task.ticketNumber ?? response.task.id} creation`
        );
        return { ...response, ...attachmentOutcome };
      }

      // logger.info('Task created successfully', {
      //   correlationId,
      //   taskId: response.task.id,
      //   ticketNumber: response.task.ticketNumber,
      //   projectId: response.task.projectId,
      // });

      return response;
    } catch (error) {
      logger.error('Failed to create task', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Moves a task from one board/project to another.
   * Use a dedicated endpoint for cross-board moves (distinct from update_task sectionId for intra-board column changes).
   */
  async moveTaskBetweenBoards(params: unknown): Promise<UpdateTaskResponse> {
    const correlationId = generateCorrelationId();
    try {
      const validatedInput = MoveTaskBetweenBoardsInputSchema.parse(params);

      const body: Record<string, unknown> = {
        target_project_id: validatedInput.target_project_id,
      };
      if (validatedInput.target_section_id !== undefined) {
        body.target_section_id = validatedInput.target_section_id;
      }
      // Forward task identification
      if (validatedInput.task_id !== undefined) body.task_id = validatedInput.task_id;
      if (validatedInput.ticket_number !== undefined) body.ticket_number = validatedInput.ticket_number;
      if (validatedInput.unique_index !== undefined) body.unique_index = validatedInput.unique_index;
      if (validatedInput.project_id !== undefined) body.project_id = validatedInput.project_id;

      const response = await this.apiClient.makeRequest<UpdateTaskResponse>(
        '/mcp/tasks/move',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        correlationId
      );

      const linkInfo = getTaskLinkInfo({
        ticketNumber: response.task.ticketNumber,
        projectId: response.task.projectId,
      });
      if (linkInfo) {
        response.task.link = linkInfo;
      }

      logger.info('Task moved between boards successfully', {
        correlationId,
        taskId: response.task.id,
        ticketNumber: response.task.ticketNumber,
        targetProjectId: validatedInput.target_project_id,
      });

      return response;
    } catch (error) {
      logger.error('Failed to move task between boards', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async assignUser(params: unknown): Promise<AssignUserResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = AssignUserInputSchema.parse(params);

      logger.debug('Assigning user to task', {
        correlationId,
        taskId: validatedInput.task_id,
        ticketNumber: validatedInput.ticket_number,
        userId: validatedInput.user_id,
        userIds: validatedInput.user_ids,
        agentId: validatedInput.agent_id,
      });

      const body: Record<string, unknown> = {};
      if (validatedInput.task_id !== undefined) body.task_id = validatedInput.task_id;
      if (validatedInput.ticket_number !== undefined) body.ticket_number = validatedInput.ticket_number;
      if (validatedInput.project_id !== undefined) body.project_id = validatedInput.project_id;
      if (validatedInput.unique_index !== undefined) body.unique_index = validatedInput.unique_index;

      if (validatedInput.assign_self === true) {
        body.assign_self = true;
      } else if (validatedInput.agent_id !== undefined) {
        body.agent_id = validatedInput.agent_id;
      } else if (validatedInput.user_id !== undefined) {
        body.user_id = validatedInput.user_id;
      } else if (validatedInput.user_ids !== undefined) {
        body.mode = 'multiple';
        body.user_ids = validatedInput.user_ids;
      }
      body.intent = validatedInput.intent;

      const response = await this.apiClient.makeRequest<AssignUserResponse>(
        '/mcp/assignees/assign',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        correlationId
      );

      logger.info('User assignment updated successfully', {
        correlationId,
        assignStatus: response.assignStatus,
        assigneeCount: response.assignees?.length ?? 0,
      });

      return response;
    } catch (error) {
      logger.error('Failed to assign user to task', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
