import prisma from "@/lib/prisma";
import { projectContentAccessWhere, savedViewBoardAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { BoardKnowledgePrincipal } from "@/lib/rag/retrieveBoardKnowledge";

export class IdempotencyAccessError extends Error {
  readonly status = 404;
  constructor() {
    super("Resource not found or access denied");
  }
}

export async function authorizeIdempotencyReplay(result: object, principal: BoardKnowledgePrincipal) {
  if (principal.teamScope == null) return;
  const project = projectContentAccessWhere(principal.userId, principal.agentId, principal.teamScope);
  let resources = 0;
  async function visit(value: unknown, kind?: string): Promise<void> {
    if (value == null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) await visit(item, kind);
      return;
    }
    const row = value as Record<string, unknown>;
    let allowed: unknown = true;
    if (["task", "tasks", "parentTask", "subTasks", "relatedTasks"].includes(kind ?? "") && row.id != null) {
      resources++;
      allowed = Number.isSafeInteger(row.id) && await prisma.task.findFirst({ where: { id: Number(row.id), project, ...(row.projectId != null ? { projectId: Number(row.projectId) } : {}) }, select: { id: true } });
    } else if (kind === "page") {
      resources++;
      allowed = await prisma.page.findFirst({ where: { ...(row.publicId ? { publicId: String(row.publicId) } : { id: Number(row.id) }), project }, select: { id: true } });
    } else if (kind === "report") {
      resources++;
      allowed = await prisma.report.findFirst({ where: { id: Number(row.id), project }, select: { id: true } });
    } else if (kind === "comment") {
      resources++;
      allowed = await prisma.comment.findFirst({ where: { id: Number(row.id), task: { project } }, select: { id: true } });
    } else if (kind === "board") {
      resources++;
      allowed = await prisma.project.findFirst({ where: { id: Number(row.id), ...project }, select: { id: true } });
    } else if (kind === "view") {
      resources++;
      allowed = await prisma.view.findFirst({ where: { id: String(row.id), project_view: { project: savedViewBoardAccessWhere(principal.userId, principal.agentId, principal.teamScope) } }, select: { id: true } });
    } else if (kind === "activity") {
      resources++;
      allowed = await prisma.agentRunActivity.findFirst({ where: { id: String(row.id), run: { agentId: principal.agentId, task: { project } } }, select: { id: true } });
    }
    if (!allowed) throw new IdempotencyAccessError();
    for (const [key, child] of Object.entries(row)) {
      if (["parentTaskId", "taskId", "task_id"].includes(key) && child != null) {
        resources++;
        if (!Number.isSafeInteger(child) || !await prisma.task.findFirst({ where: { id: Number(child), project }, select: { id: true } })) throw new IdempotencyAccessError();
      }
      await visit(child, key);
    }
  }
  try {
    await visit(result);
  } catch {
    throw new IdempotencyAccessError();
  }
  if (!resources) throw new IdempotencyAccessError();
}
