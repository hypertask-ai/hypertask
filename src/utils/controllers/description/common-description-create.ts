import prisma from "@/lib/prisma";
import { assertAgentAssignmentChangeAllowed } from "@/lib/mcp/tasks/agentMutationFence";
import type { Prisma } from "@prisma/client";
import { normalizeBlockHtml } from "@/lib/mcp/normalizeBlockHtml";

interface IParams {
  taskId: number;
  creatorId: number;
  content?: string;
  agentId?: string | null;
  actingUserId: number;
}

const TASK_DESCRIPTION_VERSION_LOCK_CLASS = 1_213_482_070;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const upsertTaskDescription = async (
  data: IParams,
  transaction?: Prisma.TransactionClient
) => {
  const { taskId, creatorId, content: inputContent = "", agentId, actingUserId } = data;
  const content = normalizeBlockHtml(inputContent);

  const upsert = async (tx: Prisma.TransactionClient) => {
    await assertAgentAssignmentChangeAllowed(
      tx,
      taskId,
      agentId,
      actingUserId
    );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TASK_DESCRIPTION_VERSION_LOCK_CLASS}::int, ${taskId}::int)`;
    const existing = await tx.description.findUnique({
      where: { taskId },
      select: { content: true },
    });

    const oldContent = existing?.content ?? "";
    if (existing && oldContent !== content) {
      const priorVersions = await tx.docVersion.count({
        where: { entityType: "task_description", entityId: taskId },
      });
      await tx.docVersion.create({
        data: {
          entityType: "task_description",
          entityId: taskId,
          version: priorVersions + 1,
          contentHtml: oldContent,
          contentText: stripHtml(oldContent),
          authorId: actingUserId,
          agentId: agentId ?? null,
        },
      });
    }

    return tx.description.upsert({
      where: { taskId },
      update: { content },
      create: { content, taskId, creatorId, agentId },
    });
  };

  return transaction ? upsert(transaction) : prisma.$transaction(upsert);
};

export default upsertTaskDescription;
