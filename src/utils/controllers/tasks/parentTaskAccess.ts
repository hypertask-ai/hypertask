import type { Prisma } from "@prisma/client";

export class ParentTaskNotFoundError extends Error {}

export async function assertParentTaskOnBoard(
  tx: Prisma.TransactionClient,
  parentTaskId: number,
  projectId: number,
): Promise<void> {
  const parents = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "Task"
    WHERE id = ${parentTaskId} AND "projectId" = ${projectId}
      AND status <> 'Deleted'
    FOR SHARE
  `;
  if (parents.length === 0) throw new ParentTaskNotFoundError();
}
