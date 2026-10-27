import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { BoardKnowledgePrincipal } from "@/lib/rag/retrieveBoardKnowledge";

export function chatAudienceWhere(
  { userId, agentId }: Pick<BoardKnowledgePrincipal, "userId" | "agentId">,
): Prisma.ChatSessionWhereInput {
  return { AND: [{ OR: [
    { agentId: null },
    { agent: { crossTeamHomeTeamId: null } },
    { agent: { userId, ...(agentId ? { id: agentId } : {}) } },
  ] }] };
}

export async function chatContentScopeWhere(
  principal: BoardKnowledgePrincipal,
  db: Pick<Prisma.TransactionClient, "project" | "task"> = prisma,
): Promise<Prisma.ChatSessionWhereInput> {
  const audience = chatAudienceWhere(principal);
  if (principal.teamScope == null) return audience;
  const project = projectContentAccessWhere(principal.userId, principal.agentId, principal.teamScope);
  const [projects, tasks] = await Promise.all([
    db.project.findMany({ where: project, select: { id: true } }),
    db.task.findMany({ where: { status: { not: "Deleted" }, project }, select: { id: true } }),
  ]);
  return { AND: [
    audience,
    { OR: [{ teamId: null }, { teamId: principal.teamScope.teamId }] },
    { OR: [{ projectId: null }, { projectId: { in: projects.map(({ id }) => id) } }] },
    { OR: [{ taskId: null }, { taskId: { in: tasks.map(({ id }) => id) } }] },
  ] };
}
