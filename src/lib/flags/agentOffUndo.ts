import type { Prisma } from "@prisma/client";
import { defaultFeatureFlagMode, type FeatureFlagMode } from "@/lib/flags";

export type AgentOffUndoRequest = {
  key: string;
  mode: FeatureFlagMode;
  commentId: number;
  projectId: number;
  uniqueIndex: number;
  projectAccessWhere: Prisma.ProjectWhereInput;
};

export async function undoesAgentOff(
  tx: Prisma.TransactionClient,
  request: AgentOffUndoRequest,
): Promise<boolean> {
  if (request.mode !== "OWNER_AND_QA") return false;
  const stored = await tx.featureFlag.findUnique({
    where: { key: request.key },
    select: { mode: true },
  });
  if ((stored?.mode ?? defaultFeatureFlagMode(request.key)) !== "OFF") return false;
  const off = await tx.featureFlagChange.findFirst({
    where: { key: request.key, newMode: "OFF" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { agentId: true },
  });
  if (!off?.agentId) return false;
  const comment = await tx.comment.findFirst({
    where: {
      id: request.commentId,
      editedAt: null,
      editedByUserId: null,
      editedByAgentId: null,
      task: {
        projectId: request.projectId,
        uniqueIndex: request.uniqueIndex,
        status: { not: "Deleted" },
        project: request.projectAccessWhere,
      },
    },
    select: { agentId: true },
  });
  return Boolean(comment?.agentId);
}
