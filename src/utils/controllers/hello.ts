import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '@/lib/prisma';

type Data = {
  name: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const boards = await prisma.project.findMany({ select: { id: true } });

  for (const board of boards) {
    const tickets = await prisma.task.findMany({
      where: { projectId: board.id },
      select: { id: true }
    });

    for (const ticket of tickets) {
      const comments = await prisma.comment.findMany({
        where: {
          taskId: ticket.id,
          activity: { not: undefined },
        },
        select: {
          activity: true,
        },
      });

      const uniqueUserIds = new Set<number>();

      for (const comment of comments) {
        const activityBody = comment.activity;
        if (
          activityBody &&
          typeof activityBody === 'object' &&
          !Array.isArray(activityBody) &&
          'fromUserId' in activityBody
        ) {
          uniqueUserIds.add((activityBody as { fromUserId: number }).fromUserId);
        }
      }

      if (uniqueUserIds.size > 0) {
        await prisma.task.update({
          where: { id: ticket.id },
          data: {
            updatedByUserIds: Array.from(uniqueUserIds),
          },
        });
      }
    }
  }
  res.status(200).json({ name: 'John Doe' })
}
