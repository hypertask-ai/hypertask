import prisma from "@/lib/prisma";
import { assertAgentAssignmentChangeAllowed } from "@/lib/mcp/tasks/agentMutationFence";
import type { Prisma } from "@prisma/client";
import { normalizeRichTextStructure } from "@/utils/helperFunctions/normalizeRichTextStructure";

interface IParams {
  taskId: number;
  creatorId: number;
  content?: string;
  agentId?: string | null;
  actingUserId: number;
}

// Every description writer uses this helper. Holding one transaction-scoped
// lock per task makes the old-content snapshot and version allocation atomic
// even when saves arrive through different API surfaces at the same time.
const TASK_DESCRIPTION_VERSION_LOCK_CLASS = 1_213_482_070;

// ponytail: minimal HTML->text for the version snapshot's contentText. Reusing
// convertToPlain would drag the Turbopuffer SDK into this hot task-save path.
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
  const content = normalizeRichTextStructure(inputContent);

  const upsert = async (tx: Prisma.TransactionClient) => {
    // Description writes are task mutations too. Acquire the same
    // server-authoritative fence as title, section, and assignment writes so
    // no direct restore/helper caller can bypass an active autonomous lease.
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

    // Snapshot the OLD description before overwriting it, but only when it
    // actually changes (skip no-op saves and first-time creation). The Task row
    // is the current version; DocVersion records past versions, mirroring pages.
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
