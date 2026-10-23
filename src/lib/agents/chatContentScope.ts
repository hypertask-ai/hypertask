import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { BoardKnowledgePrincipal } from "@/lib/rag/retrieveBoardKnowledge";

export async function chatContentScopeWhere(
  principal: BoardKnowledgePrincipal,
  db: Pick<Prisma.TransactionClient, "project" | "task"> = prisma,
): Promise<Prisma.ChatSessionWhereInput> {
  if (principal.teamScope == null) return {};
  const project = projectContentAccessWhere(principal.userId, principal.agentId, principal.teamScope);
  const [projects, tasks] = await Promise.all([
    db.project.findMany({ where: project, select: { id: true } }),
    db.task.findMany({ where: { status: { not: "Deleted" }, project }, select: { id: true } }),
  ]);
  return { AND: [
    { OR: [{ teamId: null }, { teamId: principal.teamScope.teamId }] },
    { OR: [{ projectId: null }, { projectId: { in: projects.map(({ id }) => id) } }] },
    { OR: [{ taskId: null }, { taskId: { in: tasks.map(({ id }) => id) } }] },
  ] };
}
