import { Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export async function canReadTaskNow(
  userId: number,
  taskId: number
): Promise<boolean> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      status: { not: Status.Deleted },
      project: {
        status: { not: Status.Deleted },
        ...projectContentAccessWhere(userId),
      },
    },
    select: { id: true },
  });
  return task !== null;
}
