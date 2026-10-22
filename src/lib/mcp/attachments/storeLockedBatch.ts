import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  AttachmentBatchError,
  AttachmentPersistenceUncertainError,
  storeAttachmentBatch,
  type AttachmentBatchDependencies,
  type StoredAttachmentResult,
  type UploadedAttachmentSpec,
} from './storeBatch';
import { persistAttachmentRows } from './persistBatch';
import {
  withAttachmentTargetLock,
  type AttachmentTargetLock,
} from './targetLock';
import type { ValidatedFileSpec } from './validateBody';

const ATTACHMENT_TRANSACTION_TIMEOUT_MS = 10_000;

type AttachmentTransactionClient = Pick<
  Prisma.TransactionClient,
  'attachment' | 'description' | 'comment' | '$queryRaw'
>;

interface LockingPrismaClient {
  $transaction<T>(
    callback: (tx: AttachmentTransactionClient) => Promise<T>,
    options: { timeout: number }
  ): Promise<T>;
}

async function persistOrReconcile(
  db: LockingPrismaClient,
  uploads: UploadedAttachmentSpec[],
  persistenceTarget: Parameters<typeof persistAttachmentRows>[2],
  signal: AbortSignal
): Promise<StoredAttachmentResult[]> {
  const transactionLockId = createHash('sha256')
    .update(
      `${persistenceTarget.taskId}:${persistenceTarget.commentId ?? ''}:${persistenceTarget.descriptionId ?? ''}`
    )
    .digest()
    .readBigInt64BE(0);
  try {
    if (signal.aborted) throw new AttachmentPersistenceUncertainError();
    const stored = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${transactionLockId})::text AS lock_result`
        );
        return persistAttachmentRows(tx, uploads, persistenceTarget);
      },
      { timeout: ATTACHMENT_TRANSACTION_TIMEOUT_MS }
    );
    if (signal.aborted) throw new AttachmentPersistenceUncertainError();
    return stored;
  } catch (persistenceError) {
    let committed: StoredAttachmentResult[];
    try {
      if (signal.aborted) throw new AttachmentPersistenceUncertainError();
      committed = await db.$transaction(
        (tx) =>
          tx.attachment.findMany({
            where: {
              taskId: persistenceTarget.taskId,
              commentId: persistenceTarget.commentId,
              descriptionId: persistenceTarget.descriptionId,
              fileSource: { in: uploads.map(({ url }) => url) },
            },
            select: {
              id: true,
              fileName: true,
              fileType: true,
              fileSource: true,
            },
          }),
        { timeout: ATTACHMENT_TRANSACTION_TIMEOUT_MS }
      );
      if (signal.aborted) throw new AttachmentPersistenceUncertainError();
    } catch {
      throw new AttachmentPersistenceUncertainError();
    }

    const bySource = new Map(committed.map((row) => [row.fileSource, row]));
    const reconciled = uploads.map(({ url }) => bySource.get(url));
    if (reconciled.every((row): row is StoredAttachmentResult => row !== undefined)) {
      return persistenceTarget.inlineImages
        ? db.$transaction((tx) => persistAttachmentRows(tx, uploads, persistenceTarget), { timeout: ATTACHMENT_TRANSACTION_TIMEOUT_MS })
        : reconciled;
    }
    if (committed.length === 0) throw persistenceError;
    throw new AttachmentPersistenceUncertainError();
  }
}

type LockedBatchDependencies = Partial<AttachmentBatchDependencies> & {
  withTargetLock?: AttachmentTargetLock;
};

export async function storeAttachmentBatchWithTargetLock(
  db: LockingPrismaClient,
  files: ValidatedFileSpec[],
  target: { taskId: number; targetKey: string },
  persistenceTarget: Parameters<typeof persistAttachmentRows>[2],
  dependencyOverrides: LockedBatchDependencies = {}
) {
  const {
    withTargetLock = withAttachmentTargetLock,
    ...batchDependencies
  } = dependencyOverrides;
  const lockKey = `mcp-attachment:${target.taskId}:${target.targetKey}`;

  try {
    return await withTargetLock(lockKey, (assertHeld = () => {}) =>
      storeAttachmentBatch(
        files,
        target,
        (uploads, signal) =>
          persistOrReconcile(db, uploads, persistenceTarget, signal),
        { ...batchDependencies, assertOwnership: assertHeld }
      )
    );
  } catch (error) {
    if (error instanceof AttachmentBatchError) throw error;
    throw new AttachmentBatchError('Attachment storage is temporarily unavailable', 503, true);
  }
}
