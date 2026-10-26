import { isPlanLimitReachedError, planLimitResponse } from "@/lib/planLimits";
import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import { getConfig } from '../../config/index';
import { AttachFilesInputSchema, type AttachFilesInput } from '../../validations/attachment.validation';

export interface AttachmentUploadItem {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  url?: string;
}

export interface AttachFilesResponse {
  status?: number;
  code?: string;
  limit?: string;
  max?: number;
  success: boolean;
  attachments: AttachmentUploadItem[];
  attachment_status?: 'complete' | 'partial' | 'failed';
  failed_files?: Array<{ index: number; filename: string; error: string }>;
  error?: string;
  message?: string;
  cleanup_confirmed?: boolean;
  retry_note?: string;
}

export interface InlineAttachmentOutcome {
  success?: boolean;
  error?: string;
  status?: 402;
  code?: "PLAN_LIMIT_REACHED";
  limit?: "boards" | "tickets" | "file_size" | "storage";
  max?: number;
  operation_message?: string;
  attachments: AttachmentUploadItem[];
  attachment_status: 'complete' | 'partial' | 'failed';
  failed_files?: Array<{ index: number; filename: string; error: string }>;
  attachment_error?: string;
  message?: string;
  cleanup_confirmed?: boolean;
  retry_note?: string;
}

export class AttachmentService {
  constructor(private readonly apiClient: IApiClient) {}

  async attachFiles(params: unknown): Promise<AttachFilesResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput: AttachFilesInput = AttachFilesInputSchema.parse(params);

      logger.debug('Attaching files to task', {
        correlationId,
        fileCount: validatedInput.files.length,
        hasCommentId: validatedInput.comment_id !== undefined,
      });

      const response = await this.apiClient.makeRequest<AttachFilesResponse>(
        '/mcp/tasks/attachments',
        {
          method: 'POST',
          body: JSON.stringify(validatedInput),
        },
        correlationId,
        { timeoutMs: getConfig().attachmentRequestTimeoutMs }
      );

      const storedCount = response.attachments?.length ?? 0;
      if (response.success && storedCount !== validatedInput.files.length) {
        return {
          ...response,
          success: false,
          attachment_status: storedCount > 0 ? 'partial' : 'failed',
          error: `Stored ${storedCount} of ${validatedInput.files.length} requested attachment(s)`,
        };
      }

      logger.info('Files attached successfully', {
        correlationId,
        count: storedCount,
      });

      return response;
    } catch (error) {
      const body = (error as { httpResponse?: unknown })?.httpResponse ?? error;
      if (isPlanLimitReachedError(body)) {
        const refusal = planLimitResponse(body);
        return { ...refusal.body, status: refusal.status, attachments: [] };
      }
      logger.failure('Failed to attach files', error, {
        correlationId,
      });
      throw error;
    }
  }
}

export async function attachFilesAfterMutation(
  apiClient: IApiClient,
  params: AttachFilesInput,
  completedOperation: string
): Promise<InlineAttachmentOutcome> {
  try {
    const result = await new AttachmentService(apiClient).attachFiles(params);
    if (!result.success) {
      const status = result.attachment_status ?? ((result.attachments?.length ?? 0) > 0 ? 'partial' : 'failed');
      const reason = result.error ?? result.message ?? 'Attachment upload failed';
      if (isPlanLimitReachedError(result)) {
        const refusal = planLimitResponse(result);
        return {
          ...refusal.body,
          attachments: [],
          attachment_status: 'failed',
          attachment_error: refusal.body.error,
          status: refusal.status,
          code: refusal.body.code,
          limit: refusal.body.limit,
          max: refusal.body.max,
          operation_message: `${completedOperation} succeeded, but attachment upload was refused: ${refusal.body.message}`,
        };
      }
      return {
        attachments: result.attachments ?? [],
        attachment_status: status,
        failed_files: result.failed_files,
        attachment_error: reason,
        ...(result.cleanup_confirmed !== undefined
          ? { cleanup_confirmed: result.cleanup_confirmed }
          : {}),
        ...(result.retry_note !== undefined
          ? { retry_note: result.retry_note }
          : {}),
        message: `${completedOperation} succeeded, but attachment upload was ${status}: ${reason}. Retry with hypertask_attach_files using the original file specifications at failed_files[].index; do not repeat the original operation or files already listed in attachments.`,
      };
    }
    return {
      attachments: result.attachments ?? [],
      attachment_status: 'complete',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const httpResponse = (error as { httpResponse?: unknown })?.httpResponse;
    const responseBody = typeof httpResponse === 'object' && httpResponse !== null
      ? httpResponse as Record<string, unknown>
      : undefined;
    const cleanupConfirmed = responseBody?.cleanup_confirmed;
    const retryNote = responseBody?.retry_note;
    return {
      attachments: [],
      attachment_status: 'failed',
      attachment_error: reason,
      ...(cleanupConfirmed === false ? { cleanup_confirmed: false } : {}),
      ...(typeof retryNote === 'string' ? { retry_note: retryNote } : {}),
      message: `${completedOperation} succeeded, but the attachment outcome is unknown: ${reason}. Inspect the task attachments, then retry with hypertask_attach_files using the original file specifications; do not repeat the original operation.`,
    };
  }
}
