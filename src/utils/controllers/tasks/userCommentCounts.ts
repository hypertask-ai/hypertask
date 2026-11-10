import prisma from "@/lib/prisma";

export async function userCommentCountsByTaskId(taskIds: number[]): Promise<Map<number, number>> {
  if (taskIds.length === 0) return new Map();
  const rows = await prisma.comment.groupBy({
    by: ["taskId"],
    where: { taskId: { in: taskIds }, creatorId: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.taskId, row._count._all]));
}
