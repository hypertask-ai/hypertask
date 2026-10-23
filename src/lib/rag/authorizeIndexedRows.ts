import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { BoardKnowledgePrincipal } from "./retrieveBoardKnowledge";
import type { TurbopufferTaskRow, TurbopufferCommentRow } from "@/utils/controllers/turbopuffer/turbopufferHelper";

export async function authorizeIndexedRows(
  taskRows: TurbopufferTaskRow[],
  commentRows: TurbopufferCommentRow[],
  principal?: BoardKnowledgePrincipal,
) {
  if (principal?.teamScope == null) return { taskRows, commentRows };
  const project = projectContentAccessWhere(principal.userId, principal.agentId, principal.teamScope);
  const [tasks, comments] = await Promise.all([
    prisma.task.findMany({
      where: { id: { in: taskRows.map((row) => Number(row.id)).filter(Number.isSafeInteger) }, status: { not: "Deleted" }, project },
      select: { id: true, projectId: true },
    }),
    prisma.comment.findMany({
      where: { id: { in: commentRows.map((row) => Number(row.id)).filter(Number.isSafeInteger) }, task: { status: { not: "Deleted" }, project } },
      select: { id: true, taskId: true, task: { select: { projectId: true } } },
    }),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  return {
    taskRows: taskRows.filter((row) => taskById.get(Number(row.id))?.projectId === row.projectId),
    commentRows: commentRows.filter((row) => {
      const comment = commentById.get(Number(row.id));
      return comment?.taskId === Number(row.taskId) && comment?.task?.projectId === row.projectId;
    }),
  };
}
