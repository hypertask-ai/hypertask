import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import {
  InboxListInputSchema,
  InboxArchiveInputSchema,
  InboxUnarchiveInputSchema,
  MoveTaskToInboxInputSchema,
} from '../../validations/inbox.validation';

/** Tab metadata from structured inbox view */
export interface InboxTab {
  idx: number;
  project: string;
  length: number;
  hasUnseen: boolean;
  projectId: number | null;
}

/** Full notification object from backend */
export interface InboxNotification {
  id: number;
  type: string;
  status: string;
  userId: number;
  taskId: number;
  projectId: number;
  seen: boolean;
  createdAt: string;
  comment?: unknown;
  reaction?: unknown;
  assignee?: unknown;
  notification_invite?: unknown;
  project?: { id: number; title: string; name?: string; teamId?: number };
  task?: {
    id: number;
    projectId: number;
    uniqueIndex: number;
    title: string;
    ticketNumber: string;
    status?: string;
    section?: string;
    dueDate?: string;
    priority?: { Priority_Value?: string };
    [key: string]: unknown;
  };
  fromUser?: { id: number; email?: string; displayName: string };
  fromAgent?: { id: string; displayName: string };
}

export interface InboxListResponse {
  success: boolean;
  /** New format: full notification objects */
  user_notifications?: InboxNotification[];
  agent_notifications?: InboxNotification[];
  /** Legacy: flat items (prefer notifications) */
  items?: unknown[];
  [key: string]: unknown;
}

/** GET /mcp/inbox/composition: who a board's unread load actually belongs to. */
export interface InboxCompositionResponse {
  success: boolean;
  project?: { id: number; title: string };
  users?: unknown[];
  [key: string]: unknown;
}

export interface InboxArchiveResponse {
  success: boolean;
  [key: string]: unknown;
}

export type InboxUnarchiveResponse = InboxArchiveResponse;

export interface MoveTaskToInboxResponse {
  success: boolean;
  message?: string;
  taskId?: number;
  userId?: number;
  error?: string;
}

/**
 * Service for inbox operations
 */
export class InboxService {
  constructor(private readonly apiClient: IApiClient) {}

  /**
   * Lists inbox notifications for a user.
   * @param params - The parameters for the inbox list operation.
   * @returns The response from the API.
   */
  async listInbox(
    params: unknown
  ): Promise<InboxListResponse | InboxCompositionResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = InboxListInputSchema.parse(params);

      if (validatedInput.composition) {
        const queryParams = new URLSearchParams({
          project_id: String(validatedInput.project_id),
        });
        return await this.apiClient.makeRequest<InboxCompositionResponse>(
          `/mcp/inbox/composition?${queryParams.toString()}`,
          { method: 'GET' },
          correlationId
        );
      }

      const listPath =
        validatedInput.user_id != null
          ? `/mcp/inbox/list?user_id=${validatedInput.user_id}`
          : '/mcp/inbox/list';

      logger.debug('Listing inbox', {
        correlationId,
        userId: validatedInput.user_id ?? 'from_jwt',
      });

      const response = await this.apiClient.makeRequest<InboxListResponse>(
        listPath,
        {
          method: 'GET',
        },
        correlationId
      );

      // logger.info('Inbox listed successfully', {
      //   correlationId,
      //   userId: validatedInput.user_id ?? 'from_jwt',
      // });

      return response;
    } catch (error) {
      logger.error('Failed to list inbox', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Archives one or multiple notifications from the user's inbox.
   * @param params - The parameters for the inbox archive operation.
   * @returns The response from the API.
   */
  async archiveInbox(params: unknown): Promise<InboxArchiveResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = InboxArchiveInputSchema.parse(params);

      logger.debug('Archiving inbox notifications', {
        correlationId,
        notificationIds: validatedInput.notification_ids,
        count: validatedInput.notification_ids.length,
      });

      const response = await this.apiClient.makeRequest<InboxArchiveResponse>(
        '/mcp/inbox/archive',
        {
          method: 'POST',
          body: JSON.stringify({ notification_ids: validatedInput.notification_ids }),
        },
        correlationId
      );

      // logger.info('Inbox notifications archived successfully', {
      //   correlationId,
      //   count: validatedInput.notification_ids.length,
      // });

      return response;
    } catch (error) {
      logger.error('Failed to archive inbox notifications', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Restores one or multiple archived inbox notifications (unarchive).
   * @param params - Same shape as archive: notification_ids.
   */
  async unarchiveInbox(params: unknown): Promise<InboxUnarchiveResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = InboxUnarchiveInputSchema.parse(params);

      logger.debug('Unarchiving inbox notifications', {
        correlationId,
        notificationIds: validatedInput.notification_ids,
        count: validatedInput.notification_ids.length,
      });

      const response = await this.apiClient.makeRequest<InboxUnarchiveResponse>(
        '/mcp/inbox/unarchive',
        {
          method: 'POST',
          body: JSON.stringify({ notification_ids: validatedInput.notification_ids }),
        },
        correlationId
      );

      logger.info('Inbox notifications unarchived successfully', {
        correlationId,
        count: validatedInput.notification_ids.length,
      });

      return response;
    } catch (error) {
      logger.error('Failed to unarchive inbox notifications', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Routes a task into a specific project member's inbox (mirrors the
   * "Move task to inbox" command-palette action). HTPR-4553.
   */
  async moveTaskToInbox(params: unknown): Promise<MoveTaskToInboxResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = MoveTaskToInboxInputSchema.parse(params);

      const body: Record<string, unknown> = { user_id: validatedInput.user_id };
      if (validatedInput.task_id !== undefined) body.task_id = validatedInput.task_id;
      if (validatedInput.ticket_number !== undefined) body.ticket_number = validatedInput.ticket_number;
      if (validatedInput.project_id !== undefined) body.project_id = validatedInput.project_id;
      if (validatedInput.unique_index !== undefined) body.unique_index = validatedInput.unique_index;

      const response = await this.apiClient.makeRequest<MoveTaskToInboxResponse>(
        '/mcp/inbox/move',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        correlationId
      );

      return response;
    } catch (error) {
      logger.error('Failed to move task to inbox', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
