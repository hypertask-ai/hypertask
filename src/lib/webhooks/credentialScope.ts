import { crossTeamProjectFence } from "@/lib/agents/crossTeam";
import prisma from "@/lib/prisma";
import { resolveAgentTeamScope } from "@/lib/auth/agentTeamScope";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { chatContentScopeWhere } from "@/lib/agents/chatContentScope";
import type { Prisma } from "@prisma/client";

type ScopeDatabase = Pick<Prisma.TransactionClient, "agent" | "project" | "task" | "comment" | "chatSession" | "agentRun">;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function webhookCredentialAllows(
  agentId: string | null | undefined,
  payload: unknown,
  target: { projectId?: number | null; teamId?: string | null; createdByAgentId?: string | null } = {},
  db: ScopeDatabase = prisma,
  requestingPrincipal?: import("@/lib/rag/retrieveBoardKnowledge").BoardKnowledgePrincipal,
): Promise<boolean> {
  agentId = target.createdByAgentId ?? agentId;
  if (!agentId) return requestingPrincipal?.teamScope == null;
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { userId: true, revokedAt: true, archivedAt: true, crossTeamHomeTeamId: true, credentialTeamId: true, credentialTeamAccessBinding: true },
    });
    if (!agent) return false;
    const credentialScope = await resolveAgentTeamScope(agent.userId, agent);
    if (requestingPrincipal?.teamScope != null && credentialScope != null && requestingPrincipal.teamScope.teamId !== credentialScope.teamId) return false;
    const teamScope = requestingPrincipal?.teamScope ?? credentialScope;
    if (agent.revokedAt != null) return false;
    if (teamScope === null && !agent.crossTeamHomeTeamId) return true;
    if (agent.crossTeamHomeTeamId && agent.archivedAt != null) return false;
    const principal = requestingPrincipal?.teamScope != null ? requestingPrincipal : { userId: agent.userId, agentId, teamScope };
    const fence = agent.crossTeamHomeTeamId ? await crossTeamProjectFence(agentId, agent.userId, db) : null;
    if (agent.crossTeamHomeTeamId && !fence) return false;
    const project = { AND: [projectContentAccessWhere(principal.userId, principal.agentId, teamScope), ...(fence ? [fence] : [])] };
    const envelope = record(typeof payload === "string" ? JSON.parse(payload) : payload);
    const data = envelope.data === undefined ? envelope : record(envelope.data);
    const task = record(data.task);
    const taskId = data.taskId ?? task.id;
    const projectId = data.projectId ?? task.projectId ?? target.projectId;
    if (/^(task|comment)\./.test(String(envelope.event)) && taskId == null) return false;
    if (target.teamId != null && teamScope != null && target.teamId !== teamScope.teamId) return false;
    for (const id of [target.projectId, projectId]) {
      if (id != null && (!Number.isSafeInteger(id) || !await db.project.findFirst({ where: { id: Number(id), ...project }, select: { id: true } }))) return false;
    }
    if (taskId != null) {
      if (!Number.isSafeInteger(taskId)) return false;
      const live = await db.task.findFirst({ where: { id: Number(taskId), project }, select: { id: true, projectId: true } });
      if (!live || projectId != null && live.projectId !== projectId) return false;
    }
    const commentId = data.commentId ?? record(data.comment).id;
    if (commentId != null && (!Number.isSafeInteger(commentId) || !await db.comment.findFirst({ where: { id: Number(commentId), ...(taskId != null ? { taskId: Number(taskId) } : {}), task: { project } }, select: { id: true } }))) return false;
    const chat = record(data.chat);
    if (chat.sessionId != null && (typeof chat.sessionId !== "string" || !await db.chatSession.findFirst({ where: { id: chat.sessionId, agentId, ...await chatContentScopeWhere(principal, db) }, select: { id: true } }))) return false;
    if (data.runId != null && (typeof data.runId !== "string" || !await db.agentRun.findFirst({ where: { id: data.runId, agentId, OR: [{ task: { project } }, { taskId: null, chatSession: await chatContentScopeWhere(principal, db) }] }, select: { id: true } }))) return false;
    if (data.agentBrief != null) {
      const brief = record(data.agentBrief);
      const refs = [brief.currentTicket, ...[brief.recentTickets, brief.openPullRequests, brief.recentComments].flatMap((items) => Array.isArray(items) ? items : [])].filter(Boolean);
      for (const item of refs) {
        const ref = record(record(item).ticket ?? item);
        if (typeof ref.url !== "string") return false;
        const match = /^https:\/\/app\.hypertask\.ai\/detail\/project-(\d+)\/(\d+)$/.exec(ref.url);
        if (!match || !await db.task.findFirst({ where: { projectId: Number(match[1]), uniqueIndex: Number(match[2]), project }, select: { id: true } })) return false;
      }
    }
    return taskId != null || projectId != null || chat.sessionId != null || data.runId != null || (teamScope != null && target.teamId === teamScope.teamId) || ["webhook.test", "ping"].includes(String(envelope.event));
  } catch {
    return false;
  }
}
