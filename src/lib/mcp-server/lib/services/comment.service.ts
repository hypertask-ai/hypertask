import type { IApiClient } from '../../types/index';
import {
  DeleteCommentInputSchema,
  GetCommentsInputSchema,
  UpdateCommentInputSchema,
  validateAndSanitizeAddCommentInput,
} from '../../validations/comment.validation';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import { buildPaginationMetadata } from '../../utils/pagination';
import {
  attachFilesAfterMutation,
  type AttachmentUploadItem,
} from './attachment.service';
import {
  idempotencyKeyForInvocation,
  type McpInvocationIdentity,
} from '../../utils/invocation-idempotency';
import { appendListQueryParams } from '@/lib/mcp/listQuery';

export interface CommentResponse {
  success: boolean;
  routedTo?: 'comments';
  visibleToPeople?: true;
  url?: string;
  comment: {
    id: number;
    text: string;
    createdAt: string;
    creatorId?: number;
  };
  attachments?: AttachmentUploadItem[];
  attachment_status?: 'complete' | 'partial' | 'failed';
  failed_files?: Array<{ index: number; filename: string; error: string }>;
  attachment_error?: string;
  cleanup_confirmed?: boolean;
  retry_note?: string;
  message?: string;
}

export interface LoggedCommentResponse {
  success: boolean;
  routedTo: 'log';
  visibleToPeople: false;
  notice: string;
  url: string;
  activity: { id: string; runId: string; type: string; text: string; createdAt: string };
}

export interface CommentDetail {
  id: number;
  text: string;
  commentText: string;
  createdAt: string;
  type?: 'comment' | 'activity';
  activity?: unknown;
  creatorId?: number;
  agent_display_name?: string;
  creator?: {
    id: number;
    email: string;
    displayName?: string;
  };
  attachments?: Array<{
    id: number;
    fileName: string;
    fileType: string;
    fileSize: number;
  }>;
  reactions?: Array<{
    id: string;
    emoji: string;
    userId: number;
    user?: {
      id: number;
      displayName?: string;
    };
  }>;
}

export interface GetCommentsResponse {
  success: boolean;
  comments: CommentDetail[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

export interface DeleteCommentResponse {
  success: boolean;
  message?: string;
}

export class CommentService {
  constructor(private readonly apiClient: IApiClient) {}

  async addComment(
    params: unknown,
    invocation?: McpInvocationIdentity,
    options: { inlineAgentImages?: boolean } = {}
  ): Promise<CommentResponse | LoggedCommentResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = validateAndSanitizeAddCommentInput(params);
      const { attachments, ...commentInput } = validatedInput;
      if (attachments?.length) {
        commentInput.has_attachments = true;
      }

      logger.debug('Adding comment', {
        correlationId,
        taskId: validatedInput.task_id,
        ticketNumber: validatedInput.ticket_number,
        projectId: validatedInput.project_id,
        uniqueIndex: validatedInput.unique_index,
        textLength: validatedInput.text.length,
      });

      const idempotencyKey = idempotencyKeyForInvocation(
        'create_comment',
        invocation,
        validatedInput
      );
      const response = await this.apiClient.makeRequest<CommentResponse | LoggedCommentResponse>(
        '/mcp/comments',
        {
          method: 'POST',
          body: JSON.stringify({ ...commentInput, ...(options.inlineAgentImages && attachments?.length ? { attachments } : {}) }),
          ...(idempotencyKey
            ? { headers: { 'Idempotency-Key': idempotencyKey } }
            : {}),
        },
        correlationId
      );


      if (attachments !== undefined) {
        const attachmentOutcome = await attachFilesAfterMutation(
          this.apiClient,
          {
            ...(commentInput.task_id === undefined ? {} : { task_id: commentInput.task_id }),
            ...(commentInput.ticket_number === undefined
              ? {}
              : { ticket_number: commentInput.ticket_number }),
            ...(commentInput.project_id === undefined || commentInput.task_id !== undefined
              ? {}
              : { project_id: commentInput.project_id }),
            ...(commentInput.unique_index === undefined
              ? {}
              : {
                  unique_index: commentInput.unique_index,
                }),
            ...('comment' in response ? { comment_id: response.comment.id } : {}),
            files: attachments,
            inline_images: commentInput.inline_images,
          },
          'comment' in response ? `Comment ${response.comment.id} creation` : `Agent activity ${response.activity.id} creation`
        );
        return { ...response, ...attachmentOutcome };
      }

      return response;
    } catch (error) {
      logger.failure('Failed to add comment', error, {
        correlationId,
      });
      throw error;
    }
  }

  async getComments(params: unknown): Promise<GetCommentsResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = GetCommentsInputSchema.parse(params);

      logger.debug('Getting comments', {
        correlationId,
        taskId: validatedInput.task_id,
        ticketNumber: validatedInput.ticket_number,
        projectId: validatedInput.project_id,
        uniqueIndex: validatedInput.unique_index,
        limit: validatedInput.limit,
        offset: validatedInput.offset,
        includeActivity: validatedInput.include_activity,
      });

      const queryParams = new URLSearchParams();

      if (validatedInput.task_id) {
        queryParams.append('task_id', String(validatedInput.task_id));
      } else if (validatedInput.ticket_number) {
        queryParams.append('ticket_number', validatedInput.ticket_number);
      } else if (validatedInput.unique_index !== undefined && validatedInput.project_id !== undefined) {
        queryParams.append('project_id', String(validatedInput.project_id));
        queryParams.append('unique_index', String(validatedInput.unique_index));
      } else {
        throw new Error('Either task_id, ticket_number, or (project_id + unique_index) must be provided');
      }

      if (validatedInput.project_id && validatedInput.unique_index === undefined) {
        queryParams.append('project_id', String(validatedInput.project_id));
      }
      if (validatedInput.limit !== undefined) {
        queryParams.append('limit', String(validatedInput.limit));
      }
      if (validatedInput.offset !== undefined) {
        queryParams.append('offset', String(validatedInput.offset));
      }
      if (validatedInput.sort_order) {
        queryParams.append('sort_order', validatedInput.sort_order);
      }
      if (validatedInput.include_activity) {
        queryParams.append('include_activity', 'true');
      }
      appendListQueryParams(queryParams, validatedInput)

      const response = await this.apiClient.makeRequest<GetCommentsResponse>(
        `/mcp/comments?${queryParams.toString()}`,
        {
          method: 'GET',
        },
        correlationId
      );

      const offset = validatedInput.offset || 0;
      const limit = validatedInput.limit || response.limit || response.comments.length;
      const paginationMetadata = buildPaginationMetadata({
        offset,
        limit,
        total: response.total,
        itemsCount: response.comments.length,
      });


      return {
        ...response,
        ...paginationMetadata,
      };
    } catch (error) {
      logger.failure('Failed to get comments', error, {
        correlationId,
      });
      throw error;
    }
  }

  async updateComment(params: unknown): Promise<CommentResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = UpdateCommentInputSchema.parse(params);

      logger.debug('Updating comment', {
        correlationId,
        commentId: validatedInput.comment_id,
        textLength: validatedInput.text.length,
      });

      const response = await this.apiClient.makeRequest<CommentResponse>(
        `/mcp/comments/${validatedInput.comment_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            text: validatedInput.text,
            content_type: validatedInput.content_type,
            inline_images: validatedInput.inline_images,
            mentions: validatedInput.mentions,
          }),
        },
        correlationId
      );

      logger.info('Comment updated successfully', {
        correlationId,
        commentId: validatedInput.comment_id,
      });

      return response;
    } catch (error) {
      logger.failure('Failed to update comment', error, {
        correlationId,
      });
      throw error;
    }
  }

  async deleteComment(params: unknown): Promise<DeleteCommentResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = DeleteCommentInputSchema.parse(params);

      logger.debug('Deleting comment', {
        correlationId,
        commentId: validatedInput.comment_id,
      });

      const response = await this.apiClient.makeRequest<DeleteCommentResponse>(
        `/mcp/comments/${validatedInput.comment_id}`,
        {
          method: 'DELETE',
        },
        correlationId
      );

      logger.info('Comment deleted successfully', {
        correlationId,
        commentId: validatedInput.comment_id,
      });

      return response;
    } catch (error) {
      logger.failure('Failed to delete comment', error, {
        correlationId,
      });
      throw error;
    }
  }
}
