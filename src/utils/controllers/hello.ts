// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '@/lib/prisma';

type Data = {
  name: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {

  // Fetch all board ids
  const boards = await prisma.project.findMany({ select: { id: true } });

  for (const board of boards) {
    // Fetch all tickets for the current board
    const tickets = await prisma.task.findMany({
      where: { projectId: board.id },
      select: { id: true }
    });

    for (const ticket of tickets) {
      // Get all comments with activity for this ticket
      const comments = await prisma.comment.findMany({
        where: {
          taskId: ticket.id,
          activity: { not: undefined },
        },
        select: {
          activity: true,
        },
      });

      // Extract unique userIds from activityBody.fromUserId
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

      // Update the task with unique userIds if any were found
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
