import { NextRequest, NextResponse } from 'next/server';

type DownloadTask = { id: number };

type DownloadAttachment = {
  fileName: string;
  fileType: string;
  fileSize: string | number | bigint | null;
  fileSource: string;
};

type DownloadedAttachment = {
  buffer: Buffer;
  contentType: string;
};

export type AttachmentDownloadDependencies<TContext> = {
  checkRateLimit: (request: NextRequest) => Promise<Response | null>;
  validateAuth: (request: NextRequest) => Promise<TContext | null>;
  authorizeRead: (context: TContext) => Promise<Response | null>;
  findTask: (context: TContext, taskId: number) => Promise<DownloadTask | null>;
  findAttachment: (taskId: number, attachmentId: number) => Promise<DownloadAttachment | null>;
  fetchAttachment: (url: string, signal: AbortSignal) => Promise<DownloadedAttachment>;
  normalizeMime: (value: string) => string;
  isStorageFetchError: (error: unknown) => boolean;
  /** Optional: persist a size discovered on download for rows that never recorded one. */
  recordMeasuredSize?: (attachmentId: number, size: number) => Promise<void>;
};

// Editor uploads once stored a hardcoded "1" instead of the real byte count, so
// a stored 1 means "never measured", not "one byte". Those rows cannot be
// integrity-checked; they are repaired with the real length on first download.
//
// Known limitation: a genuine one-byte upload also reads as unmeasured, so
// one-byte files skip the length check and are simply rewritten with their true
// size. Removing that gap needs a separate measured flag, not a size sentinel.
const LEGACY_UNMEASURED_SIZE = 1;

type StoredSize =
  | { kind: 'measured'; size: number }
  | { kind: 'unmeasured' }
  | { kind: 'invalid' };

function readStoredSize(value: string | number | bigint | null): StoredSize {
  if (value === null || value === undefined) return { kind: 'unmeasured' };
  // A stored string has to be the exact canonical decimal the writer produces.
  // '01', ' 1 ' and '1e0' all read as 1 through Number(), which would classify
  // them as the legacy sentinel while the repair path only rewrites '1', so
  // they would skip the length check forever.
  if (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value)) {
    return { kind: 'invalid' };
  }
  const size = Number(value);
  // A stored size that is not a plain non-negative integer is corrupt metadata.
  // Serving those bytes unchecked would silently drop the integrity guarantee,
  // so they fail closed instead of being mistaken for an unmeasured row.
  if (!Number.isSafeInteger(size) || size < 0) return { kind: 'invalid' };
  // Known ceiling: a genuine one-byte attachment is indistinguishable from the
  // legacy sentinel, so it is served and re-measured rather than length-checked.
  // Distinguishing them needs a measured flag on the row, tracked separately.
  if (size === LEGACY_UNMEASURED_SIZE) return { kind: 'unmeasured' };
  return { kind: 'measured', size };
}

function downloadName(value: string): string {
  return value.replace(/[\r\n"\\/]/g, '_').trim().slice(0, 255) || 'attachment';
}

export function createAttachmentDownloadHandler<TContext>(
  dependencies: AttachmentDownloadDependencies<TContext>
) {
  return async function downloadAttachment(request: NextRequest) {
    const rateLimited = await dependencies.checkRateLimit(request);
    if (rateLimited) return rateLimited;

    const context = await dependencies.validateAuth(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      );
    }

    const scopeError = await dependencies.authorizeRead(context);
    if (scopeError) return scopeError;

    const taskId = Number(request.nextUrl.searchParams.get('task_id'));
    const attachmentId = Number(request.nextUrl.searchParams.get('attachment_id'));
    if (!Number.isSafeInteger(taskId) || taskId <= 0 || !Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
      return NextResponse.json(
        { success: false, error: 'task_id and attachment_id must be positive integers.' },
        { status: 400 }
      );
    }

    const task = await dependencies.findTask(context, taskId);
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      );
    }

    const attachment = await dependencies.findAttachment(task.id, attachmentId);
    if (!attachment) {
      return NextResponse.json(
        { success: false, error: 'Attachment not found or access denied' },
        { status: 404 }
      );
    }

    try {
      const fetched = await dependencies.fetchAttachment(attachment.fileSource, request.signal);
      const stored = readStoredSize(attachment.fileSize);
      if (
        stored.kind === 'invalid' ||
        (stored.kind === 'measured' && fetched.buffer.length !== stored.size)
      ) {
        return NextResponse.json(
          { success: false, error: 'Attachment integrity check failed.' },
          { status: 409 }
        );
      }

      const declaredType = dependencies.normalizeMime(attachment.fileType);
      if (declaredType !== 'application/octet-stream' && fetched.contentType !== declaredType) {
        return NextResponse.json(
          { success: false, error: 'Attachment content type did not match its metadata.' },
          { status: 409 }
        );
      }

      // Repaired only once the bytes have passed every other check, so a
      // rejected download never writes its length back to the row.
      if (stored.kind === 'unmeasured' && dependencies.recordMeasuredSize) {
        try {
          await dependencies.recordMeasuredSize(attachmentId, fetched.buffer.length);
        } catch (error) {
          // Serving the bytes matters more than repairing the stored size.
          console.error('[MCP attachment size repair]', error);
        }
      }

      const fileName = downloadName(attachment.fileName);
      const asciiFileName = fileName.replace(/[^\x20-\x7E]/g, '_');
      return new NextResponse(new Uint8Array(fetched.buffer), {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Disposition': `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'Content-Length': String(fetched.buffer.length),
          'Content-Type': declaredType || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      console.error('[MCP attachment download]', error);
      return NextResponse.json(
        {
          success: false,
          error: dependencies.isStorageFetchError(error)
            ? 'Attachment storage is temporarily unavailable.'
            : 'Failed to download attachment.',
        },
        { status: 502 }
      );
    }
  };
}
