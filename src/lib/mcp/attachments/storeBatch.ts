import { createHash } from 'node:crypto';
import {
  buildTaskAttachmentStorageKey,
  getHypertasksObjectState,
  uploadTaskAttachmentToS3,
} from '@/lib/storage/uploadTaskAttachmentToS3';
import { getHypertasksStoragePublicUrl } from '@/lib/storage/hypertasksS3';
import {
  MCP_ATTACHMENT_BATCH_TIMEOUT_MS,
  MCP_ATTACHMENT_MAX_BATCH_BYTES,
  normalizeMime,
} from './constants';
import { bufferMatchesDeclaredMime } from './magicBytes';
import { McpAttachmentFetchError, safeFetchAttachmentUrl } from './safeFetch';
import type { ValidatedFileSpec } from './validateBody';

export interface UploadedAttachmentSpec {
  filename: string;
  contentType: string;
  fileSize: number;
  url: string;
}

export interface StoredAttachmentResult {
  id: number;
  fileName: string;
  fileType: string;
  fileSource: string;
  fileSize?: number;
}

export interface FailedAttachmentFile {
  index: number;
  filename: string;
  error: string;
}

export class AttachmentBatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cleanupConfirmed: boolean,
    readonly attachments: StoredAttachmentResult[] = [],
    readonly failedFiles: FailedAttachmentFile[] = []
  ) {
    super(message);
    this.name = 'AttachmentBatchError';
  }
}

export class AttachmentPersistenceUncertainError extends Error {
  constructor() {
    super('Attachment persistence outcome could not be confirmed');
    this.name = 'AttachmentPersistenceUncertainError';
  }
}

class AttachmentBatchTimeoutError extends Error {
  constructor() {
    super('Attachment batch timed out');
    this.name = 'AttachmentBatchTimeoutError';
  }
}

function assertBatchActive(signal: AbortSignal): void {
  if (signal.aborted) throw new AttachmentBatchTimeoutError();
}

export interface AttachmentBatchDependencies {
  fetchUrl: typeof safeFetchAttachmentUrl;
  upload: typeof uploadTaskAttachmentToS3;
  buildKey: typeof buildTaskAttachmentStorageKey;
  objectState: typeof getHypertasksObjectState;
  publicUrlForKey: typeof getHypertasksStoragePublicUrl;
  assertOwnership: () => void;
  batchTimeoutMs: number;
}

const defaultDependencies: AttachmentBatchDependencies = {
  fetchUrl: safeFetchAttachmentUrl,
  upload: uploadTaskAttachmentToS3,
  buildKey: buildTaskAttachmentStorageKey,
  objectState: getHypertasksObjectState,
  publicUrlForKey: getHypertasksStoragePublicUrl,
  assertOwnership: () => {},
  batchTimeoutMs: MCP_ATTACHMENT_BATCH_TIMEOUT_MS,
};

interface PreparedAttachment {
  spec: ValidatedFileSpec;
  buffer: Buffer;
  contentType: string;
  storageKey: string;
}

function withFileSizes(
  stored: StoredAttachmentResult[],
  uploads: UploadedAttachmentSpec[]
): StoredAttachmentResult[] {
  const sizeByUrl = new Map(uploads.map((upload) => [upload.url, upload.fileSize]));
  return stored.map((attachment) => ({
    ...attachment,
    fileSize: sizeByUrl.get(attachment.fileSource),
  }));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function remainingFailures(
  files: Array<Pick<ValidatedFileSpec, 'filename'>>,
  failedIndex: number,
  firstError: string
): FailedAttachmentFile[] {
  return files.slice(failedIndex).map((file, offset) => ({
    index: failedIndex + offset,
    filename: file.filename,
    error:
      offset === 0
        ? firstError
        : 'Not attempted because an earlier attachment failed',
  }));
}

function preparationFailures(
  files: Array<Pick<ValidatedFileSpec, 'filename'>>,
  failedIndex: number,
  firstError: string
): FailedAttachmentFile[] {
  return files.map((file, index) => ({
    index,
    filename: file.filename,
    error:
      index === failedIndex
        ? firstError
        : 'Not attempted because the batch failed during preparation',
  }));
}

export async function storeAttachmentBatch(
  files: ValidatedFileSpec[],
  target: { taskId: number; targetKey: string },
  persist: (
    uploads: UploadedAttachmentSpec[],
    signal: AbortSignal
  ) => Promise<StoredAttachmentResult[]>,
  dependencyOverrides: Partial<AttachmentBatchDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const batchController = new AbortController();
  const batchTimer = setTimeout(
    () => batchController.abort(),
    dependencies.batchTimeoutMs
  );
  batchTimer.unref?.();
  const batchSignal = batchController.signal;
  const uploads: UploadedAttachmentSpec[] = [];
  const prepared: PreparedAttachment[] = [];
  const preparedStorageKeys = new Set<string>();
  const preparedContentIndexes = new Map<string, number>();
  let preparedBytes = 0;

  try {
    // Resolve and validate every input before the first storage write. A bad URL
    // later in the batch therefore cannot strand objects uploaded for earlier files.
    try {
      for (const [specIndex, spec] of files.entries()) {
        assertBatchActive(batchSignal);
        let buffer: Buffer;
        let contentType: string;

        if (spec.kind === 'data') {
          buffer = spec.buffer;
          contentType = spec.contentType;
        } else {
          const fetched = await dependencies.fetchUrl(spec.url, batchSignal);
          assertBatchActive(batchSignal);
          if (normalizeMime(spec.contentType) !== normalizeMime(fetched.contentType)) {
            throw new McpAttachmentFetchError(
              `Declared content_type ${spec.contentType} does not match URL response ${fetched.contentType}`
            );
          }
          if (!bufferMatchesDeclaredMime(fetched.buffer, fetched.contentType)) {
            throw new McpAttachmentFetchError(
              'Downloaded content does not match declared content type'
            );
          }
          buffer = fetched.buffer;
          contentType = fetched.contentType;
        }

        const storageKey = dependencies.buildKey({
          taskId: target.taskId,
          targetKey: target.targetKey,
          fileName: spec.filename,
          contentType,
          buffer,
        });
        const contentHash = createHash('sha256').update(buffer).digest('hex');
        const duplicateIndex = preparedContentIndexes.get(contentHash);
        if (duplicateIndex !== undefined) {
          throw new McpAttachmentFetchError(
            `files[${specIndex}] duplicates files[${duplicateIndex}] by content`
          );
        }
        if (preparedStorageKeys.has(storageKey)) {
          throw new McpAttachmentFetchError(
            `Duplicate attachment specification: ${spec.filename}`
          );
        }
        preparedBytes += buffer.length;
        if (preparedBytes > MCP_ATTACHMENT_MAX_BATCH_BYTES) {
          throw new McpAttachmentFetchError(
            `Attachment batch exceeds ${MCP_ATTACHMENT_MAX_BATCH_BYTES} decoded bytes`
          );
        }
        preparedStorageKeys.add(storageKey);
        preparedContentIndexes.set(contentHash, specIndex);
        prepared.push({ spec, buffer, contentType, storageKey });
      }
    } catch (error) {
      const effectiveError = batchSignal.aborted
        ? new AttachmentBatchTimeoutError()
        : error;
      const isInputFailure = effectiveError instanceof McpAttachmentFetchError;
      const isTimeout = effectiveError instanceof AttachmentBatchTimeoutError;
      throw new AttachmentBatchError(
        isInputFailure || isTimeout ? effectiveError.message : 'Failed to store attachment(s)',
        isInputFailure ? 400 : isTimeout ? 504 : 500,
        true,
        [],
        preparationFailures(
          files,
          prepared.length,
          errorMessage(effectiveError, 'Attachment preparation failed')
        )
      );
    }

    for (let itemIndex = 0; itemIndex < prepared.length; itemIndex += 1) {
      const item = prepared[itemIndex];
      const { spec, buffer, contentType, storageKey } = item;
      let uploadStarted = false;
      let uploadCompleted = false;
      try {
        assertBatchActive(batchSignal);
        dependencies.assertOwnership();
        uploadStarted = true;
        const url = await dependencies.upload(
          buffer,
          spec.filename,
          contentType,
          storageKey,
          batchSignal
        );
        assertBatchActive(batchSignal);
        uploads.push({
          filename: spec.filename,
          contentType,
          fileSize: buffer.length,
          url,
        });
        uploadCompleted = true;
        dependencies.assertOwnership();
      } catch (error) {
        const effectiveError = batchSignal.aborted
          ? new AttachmentBatchTimeoutError()
          : error;
        const isTimeout = effectiveError instanceof AttachmentBatchTimeoutError;
        let state: Awaited<ReturnType<typeof dependencies.objectState>> =
          uploadCompleted ? 'exists' : 'unknown';
        if (!uploadCompleted && uploadStarted) {
          try {
            state = await dependencies.objectState(storageKey, batchSignal);
            assertBatchActive(batchSignal);
          } catch {
            state = 'unknown';
          }
        }

        // A lost upload response may hide a committed object. Persisting its
        // deterministic identity gives every possible object a durable attachment
        // row; a retry overwrites the same key if the object was actually absent.
        if (!uploadCompleted && uploadStarted && state !== 'missing') {
          uploads.push({
            filename: spec.filename,
            contentType,
            fileSize: buffer.length,
            url: dependencies.publicUrlForKey(storageKey),
          });
        }

        let stored: StoredAttachmentResult[] = [];
        if (uploads.length > 0) {
          try {
            dependencies.assertOwnership();
            stored = withFileSizes(
              await persist(uploads, batchSignal),
              uploads
            );
            assertBatchActive(batchSignal);
            dependencies.assertOwnership();
          } catch {
            throw new AttachmentBatchError(
              'Failed to store attachment(s)',
              500,
              false
            );
          }
        }

        throw new AttachmentBatchError(
          isTimeout ? effectiveError.message : 'Failed to store attachment(s)',
          isTimeout ? 504 : 500,
          state !== 'unknown',
          stored,
          remainingFailures(
            files,
            itemIndex,
            errorMessage(effectiveError, 'Upload failed')
          )
        );
      }
    }

    try {
      assertBatchActive(batchSignal);
      dependencies.assertOwnership();
      const stored = await persist(uploads, batchSignal);
      assertBatchActive(batchSignal);
      dependencies.assertOwnership();
      return withFileSizes(stored, uploads);
    } catch (error) {
      if (
        error instanceof AttachmentPersistenceUncertainError ||
        error instanceof AttachmentBatchTimeoutError ||
        batchSignal.aborted
      ) {
        throw new AttachmentBatchError('Failed to store attachment(s)', 500, false);
      }
      // Never delete a deterministic object inline after an async failure. The
      // lease can expire while S3 is processing a delete, allowing a retry to
      // overwrite the same key before the delayed delete lands. Keeping the
      // bounded deterministic object is safer; a retry reuses it.
      throw new AttachmentBatchError('Failed to store attachment(s)', 500, false);
    }
  } finally {
    clearTimeout(batchTimer);
  }
}
