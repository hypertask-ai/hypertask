import { NextRequest, NextResponse } from 'next/server';
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth';
import prisma from '@/lib/prisma';
import { requireRole } from '@/lib/mcp/agents/scopes';
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask';
import { parseAndValidateAttachmentsBody } from '@/lib/mcp/attachments/validateBody';
import {
  McpAttachmentRequestBodyError,
  readMcpAttachmentJsonBody,
} from '@/lib/mcp/attachments/readRequestBody';
import {
  AttachmentBatchError,
} from '@/lib/mcp/attachments/storeBatch';
import { storeAttachmentBatchWithTargetLock } from '@/lib/mcp/attachments/storeLockedBatch';
import {
  McpAttachmentFetchError,
  safeFetchAttachmentUrl,
} from '@/lib/mcp/attachments/safeFetch';
import { normalizeMime } from '@/lib/mcp/attachments/constants';
import { createAttachmentDownloadHandler } from '@/lib/mcp/attachments/downloadHandler';
import {
  broadcastTaskChange,
  broadcastTaskComment,
} from '@/lib/realtime/server';

export const maxDuration = 700;

// Native clients receive bytes only after both task access and attachment
// ownership are checked; the durable storage URL never crosses this API boundary.
export const GET = createAttachmentDownloadHandler({
  checkRateLimit: checkMcpRateLimit,
  validateAuth: validateMcpAuth,
  authorizeRead: async (ctx) => ctx.agentId ? requireRole(ctx, 'read') : null,
  findTask: (ctx, taskId) => findTaskByIdentifier(
    ctx.user,
    { task_id: taskId, ticket_number: null, unique_index: null, project_id: null },
    ctx.agentId
  ),
  findAttachment: (taskId, attachmentId) => prisma.attachment.findFirst({
    where: { id: attachmentId, taskId },
    select: { fileName: true, fileType: true, fileSize: true, fileSource: true },
  }),
  fetchAttachment: safeFetchAttachmentUrl,
  normalizeMime,
  isStorageFetchError: (error) => error instanceof McpAttachmentFetchError,
  // Only rows that are still unmeasured are repaired, so a concurrent download
  // or a real upload that recorded a size in the meantime is never overwritten.
  recordMeasuredSize: async (attachmentId, size) => {
    await prisma.attachment.updateMany({
      where: { id: attachmentId, OR: [{ fileSize: null }, { fileSize: '1' }] },
      data: { fileSize: String(size) },
    });
  },
});

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
      { status: 401 }
    );
  }
  if (ctx.agentId) {
    const scopeError = await requireRole(ctx, 'write');
    if (scopeError) return scopeError;
  }
  const user = ctx.user;
  let body: unknown;
  try {
    body = await readMcpAttachmentJsonBody(request);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof McpAttachmentRequestBodyError
            ? error.message
            : 'Request body must be valid JSON',
      },
      {
        status:
          error instanceof McpAttachmentRequestBodyError ? error.status : 400,
      }
    );
  }

  let parsed: ReturnType<typeof parseAndValidateAttachmentsBody>;
  try {
    parsed = parseAndValidateAttachmentsBody(body);
  } catch (e) {
    const status = (e as Error & { status?: number }).status ?? 400;
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status }
    );
  }

  const task = await findTaskByIdentifier(
    user,
    {
      task_id: parsed.task_id ?? null,
      ticket_number: parsed.ticket_number ?? null,
      unique_index: parsed.unique_index ?? null,
      project_id: parsed.project_id ?? null,
    },
    ctx.agentId
  );

  if (!task) {
    return NextResponse.json(
      { success: false, error: 'Task not found or access denied' },
      { status: 404 }
    );
  }

  let descriptionId: string | null = null;
  let commentId: number | null = null;

  if (parsed.comment_id !== undefined) {
    const comment = await prisma.comment.findFirst({
      where: { id: parsed.comment_id, taskId: task.id },
      select: { id: true },
    });
    if (!comment) {
      return NextResponse.json(
        { success: false, error: 'Comment not found or does not belong to this task' },
        { status: 404 }
      );
    }
    commentId = comment.id;
  } else {
    const description = await prisma.description.findUnique({
      where: { taskId: task.id },
      select: { id: true },
    });
    if (!description) {
      return NextResponse.json(
        { success: false, error: 'Task description not found' },
        { status: 404 }
      );
    }
    descriptionId = description.id;
  }

  try {
    const targetKey = commentId !== null ? `comment-${commentId}` : `description-${descriptionId}`;
    const createdAttachments = await storeAttachmentBatchWithTargetLock(
      prisma,
      parsed.files,
      { taskId: task.id, targetKey },
      {
        taskId: task.id,
        commentId,
        descriptionId,
      }
    );

    if (commentId !== null) {
      void broadcastTaskComment(task.id);
    } else {
      void broadcastTaskChange(task.id);
    }

    return NextResponse.json({
      success: true,
      attachment_status: 'complete',
      attachments: createdAttachments.map((created) => ({
        id: created.id,
        fileName: created.fileName,
        fileType: created.fileType,
        fileSize: created.fileSize,
        url: created.fileSource,
      })),
    });
  } catch (e) {
    console.error('[MCP attachments]', e);
    const status = e instanceof AttachmentBatchError ? e.status : 500;
    const partialAttachments =
      e instanceof AttachmentBatchError ? e.attachments : [];
    if (partialAttachments.length > 0) {
      if (commentId !== null) {
        void broadcastTaskComment(task.id);
      } else {
        void broadcastTaskChange(task.id);
      }
    }
    return NextResponse.json(
      {
        success: false,
        attachment_status: partialAttachments.length > 0 ? 'partial' : 'failed',
        attachments: partialAttachments.map((created) => ({
          id: created.id,
          fileName: created.fileName,
          fileType: created.fileType,
          fileSize: created.fileSize,
          url: created.fileSource,
        })),
        ...(e instanceof AttachmentBatchError && e.failedFiles.length > 0
          ? { failed_files: e.failedFiles }
          : {}),
        error:
          e instanceof AttachmentBatchError
            ? e.message
            : 'Failed to store attachment(s)',
        ...(e instanceof AttachmentBatchError && !e.cleanupConfirmed
          ? {
              cleanup_confirmed: false,
              retry_note: 'Cleanup could not be confirmed. Retrying the same files reuses their storage keys.',
            }
          : {}),
      },
      // Partial rows must reach MCP callers so they do not retry already-linked
      // objects. A logical failure is still represented by success: false.
      { status: partialAttachments.length > 0 ? 200 : status }
    );
  }
}
